import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { resolveBranchId, resolveEffectiveBranchId, canAccessBranch } from "../utils/branchScope";

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
 * Get single fee category detail, with how many fee structures
 * currently use it (useful context before deciding to deactivate/edit
 * it, and mirrors the count deleteFeeCategory already checks before
 * blocking a delete).
 */
export const getFeeCategoryById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const category = await prisma.feeCategory.findUnique({ where: { id } });
    if (!category) { sendError(res, "Category not found", 404); return; }
    if (!canAccessBranch(req, category.branchId)) { sendError(res, "Category not found", 404); return; }

    const structureCount = await prisma.feeStructure.count({ where: { feeCategoryId: id } });

    sendSuccess(res, { ...category, structureCount }, "Fee category fetched");
  } catch (error) {
    sendError(res, "Failed to fetch fee category", 500, (error as Error).message);
  }
};

/**
 * Create custom fee category
 */
export const createFeeCategory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // isMandatory (spec Section 19 - "mark each as mandatory or
    // optional") and lateFeeGraceDays (spec Section 19 - "3-day grace
    // period, configurable per fee category") are both optional here
    // and default at the schema level (isMandatory: true,
    // lateFeeGraceDays: 3) so existing category-creation callers are
    // unaffected.
    const { name, code, isMandatory, lateFeeGraceDays } = req.body;
    // BUG FIX: the "Add Custom Fee Category" form has no branch-picker,
    // so req.body.branchId always arrived as "" - see
    // resolveEffectiveBranchId's doc comment.
    const branchId = resolveEffectiveBranchId(req, req.body.branchId);

    if (!branchId) {
      sendError(res, "Branch ID could not be resolved - please select a branch", 400);
      return;
    }
    if (!canAccessBranch(req, branchId)) {
      sendError(res, "Access denied: branch mismatch", 403);
      return;
    }

    const existing = await prisma.feeCategory.findUnique({
      where: { branchId_code: { branchId, code } },
    });
    if (existing) { sendError(res, "Fee category code already exists", 400); return; }

    const category = await prisma.feeCategory.create({
      data: {
        branchId, name, code, isSystem: false, isActive: true,
        ...(isMandatory !== undefined && { isMandatory }),
        ...(lateFeeGraceDays !== undefined && { lateFeeGraceDays }),
      },
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
    const { name, isActive, isMandatory, lateFeeGraceDays } = req.body;

    const category = await prisma.feeCategory.findUnique({ where: { id } });
    if (!category) { sendError(res, "Category not found", 404); return; }
    if (!canAccessBranch(req, category.branchId)) { sendError(res, "Category not found", 404); return; }

    const updated = await prisma.feeCategory.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(isActive !== undefined && { isActive }),
        ...(isMandatory !== undefined && { isMandatory }),
        ...(lateFeeGraceDays !== undefined && { lateFeeGraceDays }),
      },
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

/**
 * Delete a fee category. Blocked for system-defined categories (these
 * back built-in flows and must always exist) and if any fee structures
 * still reference it.
 */
export const deleteFeeCategory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const category = await prisma.feeCategory.findUnique({ where: { id } });
    if (!category) { sendError(res, "Category not found", 404); return; }
    if (!canAccessBranch(req, category.branchId)) { sendError(res, "Category not found", 404); return; }
    if (category.isSystem) { sendError(res, "Cannot delete a system-defined fee category", 400); return; }

    const structureCount = await prisma.feeStructure.count({ where: { feeCategoryId: id } });
    if (structureCount > 0) {
      sendError(res, `Cannot delete: ${structureCount} fee structure(s) use this category. Remove those first.`, 400);
      return;
    }

    await prisma.feeCategory.delete({ where: { id } });
    sendSuccess(res, null, "Fee category deleted");
  } catch (error) {
    sendError(res, "Failed to delete fee category", 500, (error as Error).message);
  }
};
