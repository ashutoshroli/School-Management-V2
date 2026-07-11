import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { resolveBranchId, resolveEffectiveBranchId, canAccessBranch } from "../utils/branchScope";

/**
 * Create academic year
 */
export const createAcademicYear = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, startDate, endDate } = req.body;
    // BUG FIX: the frontend's "Add Year" form has no branch-picker, so
    // req.body.branchId always arrived as "" - see
    // resolveEffectiveBranchId's doc comment for the full story. Falls
    // back to the caller's own branch instead of trusting the blank
    // client value.
    const branchId = resolveEffectiveBranchId(req, req.body.branchId);

    if (!branchId) {
      sendError(res, "Branch ID could not be resolved - please select a branch", 400);
      return;
    }

    if (!canAccessBranch(req, branchId)) {
      sendError(res, "Access denied: branch mismatch", 403);
      return;
    }

    // Check uniqueness
    const existing = await prisma.academicYear.findUnique({
      where: { branchId_name: { branchId, name } },
    });
    if (existing) {
      sendError(res, "Academic year with this name already exists for this branch", 400);
      return;
    }

    const academicYear = await prisma.academicYear.create({
      data: {
        branchId,
        name,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        isActive: false,
      },
    });

    sendSuccess(res, academicYear, "Academic year created successfully", 201);
  } catch (error) {
    sendError(res, "Failed to create academic year", 500, (error as Error).message);
  }
};

/**
 * Get all academic years for a branch
 */
export const getAcademicYears = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);

    if (!branchId) {
      sendError(res, "Branch ID required", 400);
      return;
    }

    const years = await prisma.academicYear.findMany({
      where: { branchId },
      orderBy: { startDate: "desc" },
    });

    sendSuccess(res, years, "Academic years fetched");
  } catch (error) {
    sendError(res, "Failed to fetch academic years", 500, (error as Error).message);
  }
};

/**
 * Set an academic year as active (deactivates others for same branch)
 */
export const setActiveYear = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const year = await prisma.academicYear.findUnique({ where: { id } });
    if (!year) {
      sendError(res, "Academic year not found", 404);
      return;
    }

    if (!canAccessBranch(req, year.branchId)) {
      sendError(res, "Academic year not found", 404);
      return;
    }

    // Deactivate all others for same branch
    await prisma.academicYear.updateMany({
      where: { branchId: year.branchId },
      data: { isActive: false },
    });

    // Activate selected
    const updated = await prisma.academicYear.update({
      where: { id },
      data: { isActive: true },
    });

    sendSuccess(res, updated, "Academic year set as active");
  } catch (error) {
    sendError(res, "Failed to update academic year", 500, (error as Error).message);
  }
};

/**
 * Update academic year
 */
export const updateAcademicYear = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, startDate, endDate } = req.body;

    const existing = await prisma.academicYear.findUnique({ where: { id } });
    if (!existing) {
      sendError(res, "Academic year not found", 404);
      return;
    }
    if (!canAccessBranch(req, existing.branchId)) {
      sendError(res, "Academic year not found", 404);
      return;
    }

    const updated = await prisma.academicYear.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(startDate && { startDate: new Date(startDate) }),
        ...(endDate && { endDate: new Date(endDate) }),
      },
    });

    sendSuccess(res, updated, "Academic year updated");
  } catch (error) {
    sendError(res, "Failed to update academic year", 500, (error as Error).message);
  }
};

/**
 * Delete an academic year. Blocked if any fee structures, exams, or
 * timetables reference it - those are financial/academic records that
 * must be removed individually first, so deleting a year can never
 * silently orphan them.
 */
export const deleteAcademicYear = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const year = await prisma.academicYear.findUnique({ where: { id } });
    if (!year) { sendError(res, "Academic year not found", 404); return; }
    if (!canAccessBranch(req, year.branchId)) { sendError(res, "Academic year not found", 404); return; }

    const [feeStructureCount, examCount, timetableCount] = await Promise.all([
      prisma.feeStructure.count({ where: { academicYearId: id } }),
      prisma.exam.count({ where: { academicYearId: id } }),
      prisma.timetable.count({ where: { academicYearId: id } }),
    ]);
    if (feeStructureCount > 0 || examCount > 0 || timetableCount > 0) {
      sendError(res, `Cannot delete: this academic year has ${feeStructureCount} fee structure(s), ${examCount} exam(s), and ${timetableCount} timetable(s) linked to it. Remove those first.`, 400);
      return;
    }

    await prisma.academicYear.delete({ where: { id } });
    sendSuccess(res, null, "Academic year deleted");
  } catch (error) {
    sendError(res, "Failed to delete academic year", 500, (error as Error).message);
  }
};
