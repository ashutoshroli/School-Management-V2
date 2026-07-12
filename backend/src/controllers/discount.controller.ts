import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { canAccessBranch, resolveBranchId } from "../utils/branchScope";

/**
 * Assign discount to student
 */
export const assignDiscount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { studentId, type, name, value, isPercent } = req.body;

    const student = await prisma.student.findUnique({ where: { id: studentId }, select: { branchId: true } });
    if (!student) { sendError(res, "Student not found", 404); return; }
    if (!canAccessBranch(req, student.branchId)) { sendError(res, "Student not found", 404); return; }

    const discount = await prisma.studentDiscount.create({
      data: { studentId, type, name, value, isPercent: isPercent || false, isActive: true },
    });

    sendSuccess(res, discount, "Discount assigned", 201);
  } catch (error) {
    sendError(res, "Failed to assign discount", 500, (error as Error).message);
  }
};

/**
 * Branch-wide discount list, for an accountant auditing every active
 * (or, with `includeInactive=true`, every) concession currently
 * granted - unlike getStudentDiscounts below (one student's own
 * history, shown on their profile page), this is the "who has a
 * discount at all" overview a finance office needs periodically.
 * Optionally narrowed to a single `type` (SIBLING/RTE/etc).
 */
export const getAllDiscounts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    if (!branchId) { sendError(res, "Branch ID required", 400); return; }

    const includeInactive = req.query.includeInactive === "true";
    const type = req.query.type as string | undefined;
    const classId = req.query.classId as string | undefined;
    const sectionId = req.query.sectionId as string | undefined;

    const studentFilter: any = { branchId };
    if (classId) studentFilter.classId = classId;
    if (sectionId) studentFilter.sectionId = sectionId;

    const where: any = { student: studentFilter };
    if (!includeInactive) where.isActive = true;
    if (type) where.type = type;

    const discounts = await prisma.studentDiscount.findMany({
      where,
      include: {
        student: {
          select: {
            id: true,
            admissionNo: true,
            user: { select: { name: true } },
            class: { select: { name: true } },
            section: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    sendSuccess(res, discounts, "Discounts fetched");
  } catch (error) {
    sendError(res, "Failed to fetch discounts", 500, (error as Error).message);
  }
};

/**
 * Get single discount detail - both getAllDiscounts (branch-wide) and
 * getStudentDiscounts (per-student) return lists, but there was no way
 * to fetch one specific discount row directly (e.g. for a detail
 * modal launched from either list).
 */
export const getDiscountById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const discount = await prisma.studentDiscount.findUnique({
      where: { id },
      include: {
        student: {
          select: {
            id: true,
            admissionNo: true,
            branchId: true,
            user: { select: { name: true } },
            class: { select: { name: true } },
            section: { select: { name: true } },
          },
        },
      },
    });
    if (!discount) { sendError(res, "Discount not found", 404); return; }
    if (!canAccessBranch(req, discount.student.branchId)) { sendError(res, "Discount not found", 404); return; }

    sendSuccess(res, discount, "Discount fetched");
  } catch (error) {
    sendError(res, "Failed to fetch discount", 500, (error as Error).message);
  }
};

/**
 * Get student's discounts
 */
export const getStudentDiscounts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { studentId } = req.params;

    const discounts = await prisma.studentDiscount.findMany({
      where: { studentId },
      orderBy: { createdAt: "desc" },
    });

    sendSuccess(res, discounts, "Discounts fetched");
  } catch (error) {
    sendError(res, "Failed to fetch discounts", 500, (error as Error).message);
  }
};

/**
 * Toggle discount active/inactive
 */
export const toggleDiscount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const discount = await prisma.studentDiscount.findUnique({ where: { id }, include: { student: { select: { branchId: true } } } });
    if (!discount) { sendError(res, "Discount not found", 404); return; }
    if (!canAccessBranch(req, discount.student.branchId)) { sendError(res, "Discount not found", 404); return; }

    const updated = await prisma.studentDiscount.update({
      where: { id },
      data: { isActive: !discount.isActive },
    });

    sendSuccess(res, updated, `Discount ${updated.isActive ? "activated" : "deactivated"}`);
  } catch (error) {
    sendError(res, "Failed to toggle discount", 500, (error as Error).message);
  }
};

/**
 * Delete discount
 */
export const deleteDiscount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const discount = await prisma.studentDiscount.findUnique({ where: { id }, include: { student: { select: { branchId: true } } } });
    if (!discount) { sendError(res, "Discount not found", 404); return; }
    if (!canAccessBranch(req, discount.student.branchId)) { sendError(res, "Discount not found", 404); return; }
    await prisma.studentDiscount.delete({ where: { id } });
    sendSuccess(res, null, "Discount removed");
  } catch (error) {
    sendError(res, "Failed to delete discount", 500, (error as Error).message);
  }
};
