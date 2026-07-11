import { Response } from "express";
import { Prisma, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError, sendPaginated } from "../utils/response";
import { resolveBranchId, resolveEffectiveBranchId, canAccessBranch } from "../utils/branchScope";
import { canAccessStudentRecord } from "../utils/studentAccess";
import { generateOneTimePassword } from "../utils/password";
import { logAuditFromRequest } from "../services/auditLog.service";
import { notify } from "../services/notification.service";
import { welcomeEmail } from "../services/notification/emailTemplates";
import { config } from "../config";

/**
 * Generate unique admission number.
 * Accepts an optional transaction client so the count read happens
 * consistently with the student.create() that follows it.
 *
 * BUG FIX: Student.admissionNo is globally unique (@unique, not
 * @@unique([branchId, ...])). This used to prefix with only the first
 * 4 characters of the branch code (branch?.code?.slice(0, 4)) - two
 * branches whose codes share the same first 4 characters (e.g. "MAIN1"
 * and "MAIN2", or simply two branches created before a distinct code
 * scheme was settled on) would generate colliding admissionNo values
 * and crash with a Prisma unique-constraint violation, surfacing as a
 * generic "Failed to create student". Using the FULL branch code (which
 * is itself globally unique - see the Branch model) guarantees the
 * resulting admissionNo can never collide across branches.
 */
const generateAdmissionNo = async (
  branchId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<string> => {
  const branch = await client.branch.findUnique({ where: { id: branchId } });
  const count = await client.student.count({ where: { branchId } });
  const prefix = branch?.code || "STD";
  return `${prefix}-${String(count + 1).padStart(5, "0")}`;
};

/**
 * Create student (Admission)
 */
export const createStudent = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      classId, sectionId, name, email, phone,
      dateOfBirth, gender, bloodGroup, religion, caste, category,
      nationality, motherTongue, address, city, state, pincode,
      previousSchool, cardId,
      // Parent info
      fatherName, fatherEmail, fatherPhone, fatherOccupation,
      motherName, motherEmail, motherPhone, motherOccupation,
    } = req.body;
    // BUG FIX: the "New Student Admission" form has no branch-picker,
    // so req.body.branchId always arrived as "" - see
    // resolveEffectiveBranchId's doc comment.
    const branchId = resolveEffectiveBranchId(req, req.body.branchId);

    if (!branchId) {
      sendError(res, "Branch ID could not be resolved - please select a branch", 400);
      return;
    }

    // SECURITY: Branch Admins may only admit students into their own branch.
    if (!canAccessBranch(req, branchId)) {
      sendError(res, "Access denied: branch mismatch", 403);
      return;
    }

    // BUG FIX: Student.cardId is an OPTIONAL @unique column (RFID Card
    // ID) - but the "New Student Admission" form always sends
    // cardId: "" when the field is left blank (which is the common
    // case; most schools don't use RFID). An empty string is a real,
    // distinct value to Postgres (unlike NULL, which @unique always
    // allows any number of), so the FIRST student admitted with a
    // blank card ID succeeded, and every subsequent one crashed on a
    // unique-constraint violation on cardId: "" - surfacing as a
    // generic "Failed to create student" with no indication why.
    // Normalize a blank cardId to undefined (omitted -> Prisma writes
    // NULL) so any number of students can have "no card assigned yet".
    const normalizedCardId = cardId && cardId.trim() !== "" ? cardId : undefined;

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
          cardId: normalizedCardId,
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
        // BUG FIX: same empty-string-collides-with-empty-string issue
        // as createStudent above - an edit that clears the RFID Card ID
        // field must write NULL, not "", or it starts colliding with
        // every OTHER student who has never had a card assigned.
        ...(cardId !== undefined && { cardId: cardId && cardId.trim() !== "" ? cardId : null }),
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

/**
 * Admin-triggered password reset for a student's login. Students are
 * created with no password at all (see createStudent above - only an
 * email/name/phone User record, meant for Google OAuth) - so this is
 * also how a student who wants to switch to (or just have a fallback
 * for) email/password login gets a password in the first place, not
 * only how an existing one gets reset.
 *
 * Generates a fresh random one-time password, hashes and saves it,
 * and returns the PLAINTEXT once in the response so the admin can
 * hand it to the student/parent - it is never stored or logged
 * anywhere in plaintext (the audit log below only records that a
 * reset happened, never the password itself), and cannot be retrieved
 * again after this response. The student should be told to change it
 * via Settings > Change Password on first login.
 */
export const resetStudentPassword = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const student = await prisma.student.findUnique({
      where: { id },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    if (!student) { sendError(res, "Student not found", 404); return; }
    if (!canAccessBranch(req, student.branchId)) { sendError(res, "Student not found", 404); return; }

    const oneTimePassword = generateOneTimePassword();
    const hashedPassword = await bcrypt.hash(oneTimePassword, 12);

    await prisma.user.update({
      where: { id: student.userId },
      data: { password: hashedPassword },
    });

    // Audit trail deliberately omits the password itself (oldData/
    // newData below only ever holds non-secret identifiers) - a
    // reset is worth recording (who did it, when, for whom), the
    // plaintext credential it produced must never persist anywhere.
    logAuditFromRequest(req, "UPDATE", "student_password_reset", id, {
      newData: { studentId: id, userId: student.userId, resetBy: req.user!.userId },
    });

    sendSuccess(
      res,
      { email: student.user.email, oneTimePassword },
      "Password reset - share this one-time password with the student now, it will not be shown again"
    );
  } catch (error) {
    sendError(res, "Failed to reset password", 500, (error as Error).message);
  }
};

/**
 * Permanently delete a student and their linked User account (and
 * their linked Parent accounts, if those parents have no other
 * children).
 *
 * Blocked if the student has any Payment history - a fee payment is
 * financial record-keeping that must never disappear; deactivate the
 * student instead (PUT .../:id with isActive: false, already supported
 * by updateStudent) rather than deleting it. Also blocked if a library
 * book is currently ISSUED to them (return it first) so stock counts
 * don't get corrupted.
 *
 * Otherwise, deletes every dependent row first, all inside one
 * transaction so a failure partway through can't leave an orphaned
 * User with no Student record.
 */
export const deleteStudent = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const student = await prisma.student.findUnique({ where: { id } });
    if (!student) { sendError(res, "Student not found", 404); return; }
    if (!canAccessBranch(req, student.branchId)) { sendError(res, "Student not found", 404); return; }

    const paymentCount = await prisma.payment.count({ where: { studentId: id } });
    if (paymentCount > 0) {
      sendError(res, `Cannot delete: this student has ${paymentCount} fee payment record(s). Deactivate them instead (edit > set inactive).`, 400);
      return;
    }

    const activeIssueCount = await prisma.libraryIssue.count({ where: { studentId: id, status: "ISSUED" } });
    if (activeIssueCount > 0) {
      sendError(res, `Cannot delete: this student currently has ${activeIssueCount} library book(s) issued. Return them first.`, 400);
      return;
    }

    await prisma.$transaction(async (tx) => {
      const parentLinks = await tx.studentParent.findMany({ where: { studentId: id } });

      await tx.studentDocument.deleteMany({ where: { studentId: id } });
      await tx.studentAttendance.deleteMany({ where: { studentId: id } });
      await tx.homeworkSubmission.deleteMany({ where: { studentId: id } });
      await tx.libraryIssue.deleteMany({ where: { studentId: id } });
      await tx.transportAllocation.deleteMany({ where: { studentId: id } });
      await tx.hostelAllocation.deleteMany({ where: { studentId: id } });
      await tx.promotion.deleteMany({ where: { studentId: id } });
      await tx.studentDiscount.deleteMany({ where: { studentId: id } });
      await tx.feeAssignment.deleteMany({ where: { studentId: id } });
      await tx.mark.deleteMany({ where: { studentId: id } });
      await tx.generatedCertificate.deleteMany({ where: { studentId: id } });
      await tx.studentParent.deleteMany({ where: { studentId: id } });
      await tx.student.delete({ where: { id } });
      await tx.user.delete({ where: { id: student.userId } });

      // Clean up any parent account that now has zero remaining
      // children - a parent record with no linked students left is
      // just dead weight (and its User can never log into anything
      // useful again).
      for (const link of parentLinks) {
        const remainingChildren = await tx.studentParent.count({ where: { parentId: link.parentId } });
        if (remainingChildren === 0) {
          const parent = await tx.parent.findUnique({ where: { id: link.parentId } });
          if (parent) {
            await tx.parent.delete({ where: { id: parent.id } });
            await tx.user.delete({ where: { id: parent.userId } });
          }
        }
      }
    });

    logAuditFromRequest(req, "DELETE", "student", id, { oldData: student });

    sendSuccess(res, null, "Student deleted");
  } catch (error) {
    sendError(res, "Failed to delete student", 500, (error as Error).message);
  }
};
