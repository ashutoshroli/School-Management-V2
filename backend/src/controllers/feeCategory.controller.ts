import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { resolveBranchId, canAccessBranch } from "../utils/branchScope";

/**
 * Get all fee categories for a branch (system + custom)
 */
export const getFeeCategories = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    if (!branchId) { sendError(res, "Branch ID required", 400); return; }

    const categories = await prisma.feeCategory.findMany({
      where: { branchId },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    });

    sendSuccess(res, categories, "Fee categories fetched");
  } catch (error) {
    sendError(res, "Failed to fetch fee categories", 500, (error as Error).message);
  }
};

/**
 * Create custom fee category
 */
export const createFeeCategory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { branchId, name, code } = req.body;

    if (!canAccessBranch(req, branchId)) {
      sendError(res, "Access denied: branch mismatch", 403);
      return;
    }

    const existing = await prisma.feeCategory.findUnique({
      where: { branchId_code: { branchId, code } },
    });
    if (existing) { sendError(res, "Fee category code already exists", 400); return; }

    const category = await prisma.feeCategory.create({
      data: { branchId, name, code, isSystem: false, isActive: true },
    });

    sendSuccess(res, category, "Fee category created", 201);
  } catch (error) {
    sendError(res, "Failed to create fee category", 500, (error as Error).message);
  }
};

/**
 * Update fee category
 */
export const updateFeeCategory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, isActive } = req.body;

    const category = await prisma.feeCategory.findUnique({ where: { id } });
    if (!category) { sendError(res, "Category not found", 404); return; }
    if (!canAccessBranch(req, category.branchId)) { sendError(res, "Category not found", 404); return; }

    const updated = await prisma.feeCategory.update({
      where: { id },
      data: { ...(name && { name }), ...(isActive !== undefined && { isActive }) },
    });

    sendSuccess(res, updated, "Fee category updated");
  } catch (error) {
    sendError(res, "Failed to update fee category", 500, (error as Error).message);
  }
};

/**
 * Toggle active status
 */
export const toggleFeeCategory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const category = await prisma.feeCategory.findUnique({ where: { id } });
    if (!category) { sendError(res, "Category not found", 404); return; }
    if (!canAccessBranch(req, category.branchId)) { sendError(res, "Category not found", 404); return; }

    const updated = await prisma.feeCategory.update({
      where: { id },
      data: { isActive: !category.isActive },
    });

    sendSuccess(res, updated, `Category ${updated.isActive ? "activated" : "deactivated"}`);
  } catch (error) {
    sendError(res, "Failed to toggle category", 500, (error as Error).message);
  }
};
