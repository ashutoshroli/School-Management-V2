import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";

/**
 * Create academic year
 */
export const createAcademicYear = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { branchId, name, startDate, endDate } = req.body;

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
    const branchId = req.query.branchId as string || req.user!.branchId;

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
