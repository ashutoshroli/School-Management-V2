import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { resolveBranchId, resolveEffectiveBranchId, canAccessBranch } from "../utils/branchScope";

// ==================== CLASS ====================

export const createClass = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, numericOrder } = req.body;
    // BUG FIX: the "Add Class" form has no branch-picker, so
    // req.body.branchId always arrived as "" - see
    // resolveEffectiveBranchId's doc comment. Also adds the
    // canAccessBranch check this endpoint was previously missing
    // entirely (a Branch Admin could otherwise have created a class in
    // another branch by just sending that branch's real id).
    const branchId = resolveEffectiveBranchId(req, req.body.branchId);

    if (!branchId) {
      sendError(res, "Branch ID could not be resolved - please select a branch", 400);
      return;
    }
    if (!canAccessBranch(req, branchId)) {
      sendError(res, "Access denied: branch mismatch", 403);
      return;
    }

    const existing = await prisma.class.findUnique({
      where: { branchId_name: { branchId, name } },
    });
    if (existing) {
      sendError(res, "Class with this name already exists in this branch", 400);
      return;
    }

    // Guard against NaN: the frontend does `parseInt(e.target.value)`
    // on the numericOrder field with no fallback - if that input is
    // ever cleared, `parseInt("")` is NaN, which Prisma rejects for an
    // Int column with a raw type error (generic 500 "Failed to create
    // class"). Default to 0 instead of trusting an unparseable value.
    const safeNumericOrder = Number.isFinite(Number(numericOrder)) ? Number(numericOrder) : 0;

    const cls = await prisma.class.create({
      data: { branchId, name, numericOrder: safeNumericOrder },
    });

    sendSuccess(res, cls, "Class created", 201);
  } catch (error) {
    sendError(res, "Failed to create class", 500, (error as Error).message);
  }
};

export const getClasses = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    if (!branchId) {
      sendError(res, "Branch ID required", 400);
      return;
    }

    const classes = await prisma.class.findMany({
      where: { branchId },
      orderBy: { numericOrder: "asc" },
      include: {
        sections: { orderBy: { name: "asc" } },
        _count: { select: { students: true } },
      },
    });

    sendSuccess(res, classes, "Classes fetched");
  } catch (error) {
    sendError(res, "Failed to fetch classes", 500, (error as Error).message);
  }
};

export const updateClass = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, numericOrder } = req.body;

    const updated = await prisma.class.update({
      where: { id },
      data: { ...(name && { name }), ...(numericOrder !== undefined && { numericOrder }) },
    });

    sendSuccess(res, updated, "Class updated");
  } catch (error) {
    sendError(res, "Failed to update class", 500, (error as Error).message);
  }
};

export const deleteClass = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // Check if class has students
    const count = await prisma.student.count({ where: { classId: id } });
    if (count > 0) {
      sendError(res, `Cannot delete: ${count} students are assigned to this class`, 400);
      return;
    }

    await prisma.class.delete({ where: { id } });
    sendSuccess(res, null, "Class deleted");
  } catch (error) {
    sendError(res, "Failed to delete class", 500, (error as Error).message);
  }
};

// ==================== SECTION ====================

export const createSection = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { classId, name, capacity, classTeacherId } = req.body;
    // BUG FIX + SECURITY: same as createClass above - no branch-picker
    // in the "Add Section" form (branchId always ""), and this
    // endpoint had no canAccessBranch check at all.
    const branchId = resolveEffectiveBranchId(req, req.body.branchId);

    if (!branchId) {
      sendError(res, "Branch ID could not be resolved - please select a branch", 400);
      return;
    }
    if (!canAccessBranch(req, branchId)) {
      sendError(res, "Access denied: branch mismatch", 403);
      return;
    }

    const existing = await prisma.section.findUnique({
      where: { classId_name: { classId, name } },
    });
    if (existing) {
      sendError(res, "Section with this name already exists in this class", 400);
      return;
    }

    const section = await prisma.section.create({
      data: { branchId, classId, name, capacity: capacity || 40, classTeacherId },
    });

    sendSuccess(res, section, "Section created", 201);
  } catch (error) {
    sendError(res, "Failed to create section", 500, (error as Error).message);
  }
};

export const getSections = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const classId = req.query.classId as string;
    const branchId = resolveBranchId(req);

    const where: any = {};
    if (classId) where.classId = classId;
    if (branchId) where.branchId = branchId;

    const sections = await prisma.section.findMany({
      where,
      orderBy: { name: "asc" },
      include: {
        class: { select: { name: true } },
        classTeacher: { select: { user: { select: { name: true } } } },
        _count: { select: { students: true } },
      },
    });

    sendSuccess(res, sections, "Sections fetched");
  } catch (error) {
    sendError(res, "Failed to fetch sections", 500, (error as Error).message);
  }
};

export const updateSection = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, capacity, classTeacherId } = req.body;

    const updated = await prisma.section.update({
      where: { id },
      data: { ...(name && { name }), ...(capacity && { capacity }), ...(classTeacherId !== undefined && { classTeacherId }) },
    });

    sendSuccess(res, updated, "Section updated");
  } catch (error) {
    sendError(res, "Failed to update section", 500, (error as Error).message);
  }
};

export const deleteSection = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const count = await prisma.student.count({ where: { sectionId: id } });
    if (count > 0) {
      sendError(res, `Cannot delete: ${count} students are assigned to this section`, 400);
      return;
    }

    await prisma.section.delete({ where: { id } });
    sendSuccess(res, null, "Section deleted");
  } catch (error) {
    sendError(res, "Failed to delete section", 500, (error as Error).message);
  }
};

// ==================== SUBJECT ====================

export const createSubject = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, code, type } = req.body;
    // BUG FIX + SECURITY: same as createClass above - no branch-picker
    // in the "Add Subject" form (branchId always ""), and this
    // endpoint had no canAccessBranch check at all.
    const branchId = resolveEffectiveBranchId(req, req.body.branchId);

    if (!branchId) {
      sendError(res, "Branch ID could not be resolved - please select a branch", 400);
      return;
    }
    if (!canAccessBranch(req, branchId)) {
      sendError(res, "Access denied: branch mismatch", 403);
      return;
    }

    const existing = await prisma.subject.findUnique({
      where: { branchId_code: { branchId, code } },
    });
    if (existing) {
      sendError(res, "Subject code already exists in this branch", 400);
      return;
    }

    const subject = await prisma.subject.create({
      data: { branchId, name, code, type: type || "THEORY" },
    });

    sendSuccess(res, subject, "Subject created", 201);
  } catch (error) {
    sendError(res, "Failed to create subject", 500, (error as Error).message);
  }
};

export const getSubjects = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    if (!branchId) {
      sendError(res, "Branch ID required", 400);
      return;
    }

    const subjects = await prisma.subject.findMany({
      where: { branchId },
      orderBy: { name: "asc" },
    });

    sendSuccess(res, subjects, "Subjects fetched");
  } catch (error) {
    sendError(res, "Failed to fetch subjects", 500, (error as Error).message);
  }
};

export const updateSubject = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, code, type } = req.body;

    const updated = await prisma.subject.update({
      where: { id },
      data: { ...(name && { name }), ...(code && { code }), ...(type && { type }) },
    });

    sendSuccess(res, updated, "Subject updated");
  } catch (error) {
    sendError(res, "Failed to update subject", 500, (error as Error).message);
  }
};

export const deleteSubject = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    await prisma.subject.delete({ where: { id } });
    sendSuccess(res, null, "Subject deleted");
  } catch (error) {
    sendError(res, "Failed to delete subject", 500, (error as Error).message);
  }
};

// ==================== CLASS-SUBJECT MAPPING ====================

export const assignSubjectToClass = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { classId, subjectId } = req.body;

    const existing = await prisma.classSubject.findUnique({
      where: { classId_subjectId: { classId, subjectId } },
    });
    if (existing) {
      sendError(res, "Subject already assigned to this class", 400);
      return;
    }

    const mapping = await prisma.classSubject.create({
      data: { classId, subjectId },
    });

    sendSuccess(res, mapping, "Subject assigned to class", 201);
  } catch (error) {
    sendError(res, "Failed to assign subject", 500, (error as Error).message);
  }
};

export const getClassSubjects = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { classId } = req.params;

    const subjects = await prisma.classSubject.findMany({
      where: { classId },
      include: { subject: true },
    });

    sendSuccess(res, subjects, "Class subjects fetched");
  } catch (error) {
    sendError(res, "Failed to fetch class subjects", 500, (error as Error).message);
  }
};

export const removeSubjectFromClass = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    await prisma.classSubject.delete({ where: { id } });
    sendSuccess(res, null, "Subject removed from class");
  } catch (error) {
    sendError(res, "Failed to remove subject", 500, (error as Error).message);
  }
};
