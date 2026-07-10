import { Response } from "express";
import { UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError, sendPaginated } from "../utils/response";

/**
 * Generate unique admission number
 */
const generateAdmissionNo = async (branchId: string): Promise<string> => {
  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  const count = await prisma.student.count({ where: { branchId } });
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

    // Generate admission number
    const admissionNo = await generateAdmissionNo(branchId);

    // Create user account for student
    const studentUser = await prisma.user.create({
      data: {
        email,
        name,
        phone,
        role: UserRole.STUDENT,
        organizationId: req.user!.organizationId || undefined,
        isActive: true,
      },
    });

    // Create student record
    const student = await prisma.student.create({
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
      let fatherUser = await prisma.user.findUnique({ where: { email: fatherEmail } });
      if (!fatherUser) {
        fatherUser = await prisma.user.create({
          data: {
            email: fatherEmail,
            name: fatherName || "Father",
            phone: fatherPhone,
            role: UserRole.PARENT,
            organizationId: req.user!.organizationId || undefined,
            isActive: true,
          },
        });
      }

      let parent = await prisma.parent.findUnique({ where: { userId: fatherUser.id } });
      if (!parent) {
        parent = await prisma.parent.create({
          data: {
            userId: fatherUser.id,
            relation: "FATHER",
            occupation: fatherOccupation,
          },
        });
      }

      // Link parent to student
      await prisma.studentParent.create({
        data: { studentId: student.id, parentId: parent.id },
      });
    }

    // Create Parent accounts (Mother)
    if (motherEmail) {
      let motherUser = await prisma.user.findUnique({ where: { email: motherEmail } });
      if (!motherUser) {
        motherUser = await prisma.user.create({
          data: {
            email: motherEmail,
            name: motherName || "Mother",
            phone: motherPhone,
            role: UserRole.PARENT,
            organizationId: req.user!.organizationId || undefined,
            isActive: true,
          },
        });
      }

      let parent = await prisma.parent.findUnique({ where: { userId: motherUser.id } });
      if (!parent) {
        parent = await prisma.parent.create({
          data: {
            userId: motherUser.id,
            relation: "MOTHER",
            occupation: motherOccupation,
          },
        });
      }

      await prisma.studentParent.create({
        data: { studentId: student.id, parentId: parent.id },
      });
    }

    // Fetch complete student with relations
    const fullStudent = await prisma.student.findUnique({
      where: { id: student.id },
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
    const branchId = req.query.branchId as string || req.user!.branchId;
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

    sendSuccess(res, updated, "Student updated");
  } catch (error) {
    sendError(res, "Failed to update student", 500, (error as Error).message);
  }
};
