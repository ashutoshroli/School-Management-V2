import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { resolveBranchId, resolveEffectiveBranchId, canAccessBranch } from "../utils/branchScope";

export const addItem = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, category, unit, minStock } = req.body;
    // BUG FIX + SECURITY: the "Add Item" form has no branch-picker, so
    // req.body.branchId always arrived as "" - see
    // resolveEffectiveBranchId's doc comment. Also adds the
    // canAccessBranch check this endpoint was previously missing
    // entirely.
    const branchId = resolveEffectiveBranchId(req, req.body.branchId);

    if (!branchId) {
      sendError(res, "Branch ID could not be resolved - please select a branch", 400);
      return;
    }
    if (!canAccessBranch(req, branchId)) {
      sendError(res, "Access denied: branch mismatch", 403);
      return;
    }

    const item = await prisma.inventoryItem.create({ data: { branchId, name, category, unit, minStock: minStock || 5, currentStock: 0 } });
    sendSuccess(res, item, "Item added", 201);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

export const getItems = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    const items = await prisma.inventoryItem.findMany({ where: { branchId }, orderBy: { name: "asc" }, include: { _count: { select: { purchases: true, issues: true } } } });
    sendSuccess(res, items, "Items fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

export const purchaseStock = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { itemId, vendor, quantity, rate, billNo, billDate } = req.body;
    const totalCost = quantity * rate;
    const purchase = await prisma.inventoryPurchase.create({
      data: { itemId, vendor, quantity, rate, totalCost, billNo, billDate: billDate ? new Date(billDate) : null },
    });
    await prisma.inventoryItem.update({ where: { id: itemId }, data: { currentStock: { increment: quantity } } });
    sendSuccess(res, purchase, "Stock purchased", 201);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

export const issueStock = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { itemId, issuedTo, quantity, purpose } = req.body;
    const item = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
    if (!item || item.currentStock < quantity) { sendError(res, "Insufficient stock", 400); return; }

    const issue = await prisma.inventoryIssue.create({
      data: { itemId, issuedTo, quantity, purpose, issuedBy: req.user!.userId },
    });
    await prisma.inventoryItem.update({ where: { id: itemId }, data: { currentStock: { decrement: quantity } } });
    sendSuccess(res, issue, "Stock issued", 201);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

export const getLowStockAlerts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    const items = await prisma.inventoryItem.findMany({
      where: { branchId, currentStock: { lte: prisma.inventoryItem.fields.minStock } },
    });
    // Prisma doesn't support field comparison directly, so filter in JS
    const allItems = await prisma.inventoryItem.findMany({ where: { branchId } });
    const lowStock = allItems.filter(i => i.currentStock <= i.minStock);
    sendSuccess(res, lowStock, "Low stock alerts");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};
