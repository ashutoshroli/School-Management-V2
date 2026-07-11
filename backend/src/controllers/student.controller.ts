import { Response } from "express";
import { Prisma, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError, sendPaginated } from "../utils/response";
import { resolveBranchId, canAccessBranch } from "../utils/branchScope";
import { canAccessStudentRecord } from "../utils/studentAccess";
import { logAuditFromRequest } from "../services/auditLog.service";
import { notify } from "../services/notification.service";
import { welcomeEmail } from "../services/notification/emailTemplates";
import { config } from "../config";

/**
 * Generate unique admission number.
 * Accepts an optional transaction client so the count read happens
 * consistently with the student.create() that follows it.
 */
const generateAdmissionNo = async (
  branchId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<string> => {
  const branch = await client.branch.findUnique({ where: { id: branchId } });
  const count = await client.student.count({ where: { branchId } });
  const prefix = branch?.code?.slice(0, 4) || "STD";
  return `${prefix}-${String(count + 1).padStart(5, "0")}`;
};

/**
 * Create student (Admission)
 */
export const createStudent = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      branchId, classId, sectionId, name, email, phone,
      dateOfBirth, gender, bloodGroup, religion, caste, category,
      nationality, motherTongue, address, city, state, pincode,
      previousSchool, cardId,
      // Parent info
      fatherName, fatherEmail, fatherPhone, fatherOccupation,
      motherName, motherEmail, motherPhone, motherOccupation,
    } = req.body;

    // SECURITY: Branch Admins may only admit students into their own branch.
    if (!canAccessBranch(req, branchId)) {
      sendError(res, "Access denied: branch mismatch", 403);
      return;
    }

    // SAFETY: admission creates a User + Student + (optionally) two more
    // Users/Parents + StudentParent links across several awaited calls.
    // Without a transaction, a failure partway through (e.g. mother's
    // record) would leave an orphaned User/Student with no parent link
    // and no student-facing account cleanup. Wrap the whole admission in
    // a single transaction so it's all-or-nothing.
    // Tracks which User accounts were newly created in this admission
    // (as opposed to an existing parent account being reused for a
    // sibling) - only NEW accounts get a welcome email after the
    // transaction commits.
    const newlyCreatedUsers: Array<{ id: string; email: string; name: string }> = [];

    const studentId = await prisma.$transaction(async (tx) => {
      // Generate admission number inside the transaction so the count
      // read is consistent with the student.create() below.
      const admissionNo = await generateAdmissionNo(branchId, tx);

      // Create user account for student
      const studentUser = await tx.user.create({
        data: {
          email,
          name,
          phone,
          role: UserRole.STUDENT,
          organizationId: req.user!.organizationId || undefined,
          isActive: true,
        },
      });
      newlyCreatedUsers.push({ id: studentUser.id, email: studentUser.email, name: studentUser.name });

      // Create student record
      const student = await tx.student.create({
        data: {
          userId: studentUser.id,
          branchId,
          admissionNo,
          classId,
          sectionId,
          dateOfBirth: new Date(dateOfBirth),
          gender,
          bloodGroup,
          religion,
          caste,
          category,
          nationality: nationality || "Indian",
          motherTongue,
          address,
          city,
          state,
          pincode,
          previousSchool,
          cardId,
          admissionDate: new Date(),
          isActive: true,
        },
      });

      // Create Parent accounts (Father)
      if (fatherEmail) {
        let fatherUser = await tx.user.findUnique({ where: { email: fatherEmail } });
        if (!fatherUser) {
          fatherUser = await tx.user.create({
            data: {
              email: fatherEmail,
              name: fatherName || "Father",
              phone: fatherPhone,
              role: UserRole.PARENT,
              organizationId: req.user!.organizationId || undefined,
              isActive: true,
            },
          });
          newlyCreatedUsers.push({ id: fatherUser.id, email: fatherUser.email, name: fatherUser.name });
        }

        let parent = await tx.parent.findUnique({ where: { userId: fatherUser.id } });
        if (!parent) {
          parent = await tx.parent.create({
            data: {
              userId: fatherUser.id,
              relation: "FATHER",
              occupation: fatherOccupation,
            },
          });
        }

        // Link parent to student
        await tx.studentParent.create({
          data: { studentId: student.id, parentId: parent.id },
        });
      }

      // Create Parent accounts (Mother)
      if (motherEmail) {
        let motherUser = await tx.user.findUnique({ where: { email: motherEmail } });
        if (!motherUser) {
          motherUser = await tx.user.create({
            data: {
              email: motherEmail,
              name: motherName || "Mother",
              phone: motherPhone,
              role: UserRole.PARENT,
              organizationId: req.user!.organizationId || undefined,
              isActive: true,
            },
          });
          newlyCreatedUsers.push({ id: motherUser.id, email: motherUser.email, name: motherUser.name });
        }

        let parent = await tx.parent.findUnique({ where: { userId: motherUser.id } });
        if (!parent) {
          parent = await tx.parent.create({
            data: {
              userId: motherUser.id,
              relation: "MOTHER",
              occupation: motherOccupation,
            },
          });
        }

        await tx.studentParent.create({
          data: { studentId: student.id, parentId: parent.id },
        });
      }

      return student.id;
    });

    // Fetch complete student with relations
    const fullStudent = await prisma.student.findUnique({
      where: { id: studentId },
      include: {
        user: { select: { name: true, email: true, phone: true } },
        class: { select: { name: true } },
        section: { select: { name: true } },
        parents: {
          include: {
            parent: {
              include: { user: { select: { name: true, email: true, phone: true } } },
            },
          },
        },
      },
    });

    logAuditFromRequest(req, "CREATE", "student", studentId, { newData: fullStudent });

    // Fire-and-forget welcome emails to every newly-created account
    // (student + any new parent accounts) - sent AFTER the transaction
    // commits, since notification delivery is a side effect that must
    // never roll back a successful admission if it fails.
    for (const newUser of newlyCreatedUsers) {
      const tmpl = welcomeEmail({
        name: newUser.name,
        email: newUser.email,
        loginUrl: `${config.frontendUrl}/auth/login`,
      });
      notify({
        userId: newUser.id,
        type: "GENERAL",
        title: tmpl.subject,
        body: tmpl.text,
        emailTemplate: tmpl,
      }).catch((err) => console.error("Failed to send welcome email:", err));
    }

    sendSuccess(res, fullStudent, "Student admitted successfully", 201);
  } catch (error) {
    sendError(res, "Failed to create student", 500, (error as Error).message);
  }
};

/**
 * Get students list (with search & filters)
 */
export const getStudents = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 25;
    const skip = (page - 1) * limit;
    const branchId = resolveBranchId(req);
    const classId = req.query.classId as string;
    const sectionId = req.query.sectionId as string;
    const search = req.query.search as string;
    const isActive = req.query.isActive !== "false";

    const where: any = { isActive };
    if (branchId) where.branchId = branchId;
    if (classId) where.classId = classId;
    if (sectionId) where.sectionId = sectionId;

    if (search) {
      where.OR = [
        { admissionNo: { contains: search, mode: "insensitive" } },
        { user: { name: { contains: search, mode: "insensitive" } } },
        { user: { email: { contains: search, mode: "insensitive" } } },
        { rollNo: { contains: search, mode: "insensitive" } },
      ];
    }

    const [students, total] = await Promise.all([
      prisma.student.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ class: { numericOrder: "asc" } }, { section: { name: "asc" } }, { user: { name: "asc" } }],
        include: {
          user: { select: { name: true, email: true, phone: true, avatar: true } },
          class: { select: { name: true } },
          section: { select: { name: true } },
        },
      }),
      prisma.student.count({ where }),
    ]);

    sendPaginated(res, students, total, page, limit, "Students fetched");
  } catch (error) {
    sendError(res, "Failed to fetch students", 500, (error as Error).message);
  }
};

/**
 * Get single student profile (full detail)
 */
export const getStudentById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const student = await prisma.student.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, avatar: true, googleId: true } },
        class: { select: { id: true, name: true } },
        section: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        parents: {
          include: {
            parent: {
              include: { user: { select: { name: true, email: true, phone: true } } },
            },
          },
        },
        documents: true,
        discounts: true,
      },
    });

    if (!student) {
      sendError(res, "Student not found", 404);
      return;
    }

    // SECURITY: prevent cross-branch access (IDOR) - only branch staff,
    // Super Admin, or the student/their linked parent may view this
    // record. (canAccessStudentRecord as a fallback rather than relying
    // solely on branchId equality - a PARENT's JWT only carries their
    // *first* child's branchId, which would incorrectly deny access to
    // a second child in a different branch.)
    if (!canAccessBranch(req, student.branchId) && !(await canAccessStudentRecord(req, id))) {
      sendError(res, "Student not found", 404);
      return;
    }

    sendSuccess(res, student, "Student profile fetched");
  } catch (error) {
    sendError(res, "Failed to fetch student", 500, (error as Error).message);
  }
};

/**
 * Update student profile
 */
export const updateStudent = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const {
      classId, sectionId, rollNo, dateOfBirth, gender, bloodGroup,
      religion, caste, category, nationality, motherTongue,
      address, city, state, pincode, cardId, name, phone, isActive,
    } = req.body;

    const student = await prisma.student.findUnique({ where: { id } });
    if (!student) {
      sendError(res, "Student not found", 404);
      return;
    }

    if (!canAccessBranch(req, student.branchId)) {
      sendError(res, "Student not found", 404);
      return;
    }

    // Update student
    const updated = await prisma.student.update({
      where: { id },
      data: {
        ...(classId && { classId }),
        ...(sectionId && { sectionId }),
        ...(rollNo !== undefined && { rollNo }),
        ...(dateOfBirth && { dateOfBirth: new Date(dateOfBirth) }),
        ...(gender && { gender }),
        ...(bloodGroup !== undefined && { bloodGroup }),
        ...(religion !== undefined && { religion }),
        ...(caste !== undefined && { caste }),
        ...(category !== undefined && { category }),
        ...(nationality !== undefined && { nationality }),
        ...(motherTongue !== undefined && { motherTongue }),
        ...(address !== undefined && { address }),
        ...(city !== undefined && { city }),
        ...(state !== undefined && { state }),
        ...(pincode !== undefined && { pincode }),
        ...(cardId !== undefined && { cardId }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    // Update user name/phone if provided
    if (name || phone) {
      await prisma.user.update({
        where: { id: student.userId },
        data: { ...(name && { name }), ...(phone && { phone }) },
      });
    }

    logAuditFromRequest(req, "UPDATE", "student", id, { oldData: student, newData: updated });

    sendSuccess(res, updated, "Student updated");
  } catch (error) {
    sendError(res, "Failed to update student", 500, (error as Error).message);
  }
};
