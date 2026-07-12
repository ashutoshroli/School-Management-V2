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

/**
 * Get single inventory item detail, with its full purchase and issue
 * history (most recent first) - the list view (getItems) only returns
 * counts (`_count`), with no way to see the actual transactions.
 */
export const getItemById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const item = await prisma.inventoryItem.findUnique({
      where: { id },
      include: {
        purchases: { orderBy: { createdAt: "desc" } },
        issues: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!item) { sendError(res, "Item not found", 404); return; }
    if (!canAccessBranch(req, item.branchId)) { sendError(res, "Item not found", 404); return; }

    sendSuccess(res, item, "Item fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

export const getItems = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    const category = req.query.category as string | undefined;

    const where: any = { branchId };
    if (category) where.category = category;

    const items = await prisma.inventoryItem.findMany({ where, orderBy: { name: "asc" }, include: { _count: { select: { purchases: true, issues: true } } } });
    sendSuccess(res, items, "Items fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

export const purchaseStock = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { itemId, vendor, quantity, rate, billNo, billDate } = req.body;
    // Guard against NaN: the frontend parseInt/parseFloat's these
    // fields with no fallback - if either is cleared after being
    // filled, `quantity * rate` becomes NaN, which Prisma rejects for
    // the Decimal `totalCost` column with a raw type error (generic
    // 500 "Failed"). Reject explicitly with a clear message instead.
    const qty = Number(quantity);
    const unitRate = Number(rate);
    if (!itemId || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(unitRate) || unitRate < 0) {
      sendError(res, "itemId, a positive quantity, and a valid rate are required", 400);
      return;
    }
    const totalCost = qty * unitRate;
    const purchase = await prisma.inventoryPurchase.create({
      data: { itemId, vendor, quantity: qty, rate: unitRate, totalCost, billNo, billDate: billDate ? new Date(billDate) : null },
    });
    await prisma.inventoryItem.update({ where: { id: itemId }, data: { currentStock: { increment: qty } } });
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

/**
 * Delete an inventory item. Purchase/issue history is deleted along
 * with it (unlike fee/staff records, this is operational stock
 * bookkeeping, not statutory financial record-keeping - a school
 * removing a discontinued item's history entirely is a reasonable and
 * expected action, not a compliance risk).
 */
export const deleteItem = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const item = await prisma.inventoryItem.findUnique({ where: { id } });
    if (!item) { sendError(res, "Item not found", 404); return; }
    if (!canAccessBranch(req, item.branchId)) { sendError(res, "Item not found", 404); return; }

    await prisma.$transaction(async (tx) => {
      await tx.inventoryPurchase.deleteMany({ where: { itemId: id } });
      await tx.inventoryIssue.deleteMany({ where: { itemId: id } });
      await tx.inventoryItem.delete({ where: { id } });
    });

    sendSuccess(res, null, "Item deleted");
  } catch (error) { sendError(res, "Failed to delete item", 500, (error as Error).message); }
};

export const getLowStockAlerts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    // BUG FIX: this used to run the SAME "fetch everything, filter in
    // JS" query twice - the first `findMany` (with a `currentStock:
    // { lte: prisma.inventoryItem.fields.minStock } }` filter) doesn't
    // actually do a column-to-column comparison at all; Prisma's
    // `fields` helper isn't a valid filter VALUE, so that call's result
    // was thrown away entirely (never even assigned to a used
    // variable) - it silently fetched every item in the branch for no
    // reason and immediately discarded it, before doing the exact same
    // full fetch again on the next line to actually filter in JS. Kept
    // the (correct, necessary) JS-side filtering - Prisma genuinely has
    // no portable way to compare two columns of the same row in a
    // `where` clause - but removed the redundant first query.
    const allItems = await prisma.inventoryItem.findMany({ where: { branchId } });
    const lowStock = allItems.filter(i => i.currentStock <= i.minStock);
    sendSuccess(res, lowStock, "Low stock alerts");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};
