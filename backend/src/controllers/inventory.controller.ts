import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { resolveBranchId, resolveEffectiveBranchId, canAccessBranch } from "../utils/branchScope";

export const addItem = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Rack/counter-wise placement + appliance/AMC/warranty tracking
    // (spec Section 17), all optional/additive.
    const { name, category, unit, minStock, rackNo, counterNo, isAppliance, warrantyExpiry, amcExpiry } = req.body;
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

    const item = await prisma.inventoryItem.create({
      data: {
        branchId, name, category, unit, minStock: minStock || 5, currentStock: 0,
        rackNo, counterNo, isAppliance: !!isAppliance,
        warrantyExpiry: warrantyExpiry ? new Date(warrantyExpiry) : null,
        amcExpiry: amcExpiry ? new Date(amcExpiry) : null,
      },
    });
    sendSuccess(res, item, "Item added", 201);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Purchase/reorder APPROVAL CHAIN (spec Section 17 - "same chain as
 * diesel/canteen: Incharge -> Manager -> Accounts -> Director"). The
 * pre-existing purchaseStock (below) remains available for small/
 * direct restocks with no approval needed; this is the new
 * approval-gated path.
 */
export const raiseInventoryPurchaseRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { itemId, vendor, quantity, estimatedCost, reason } = req.body;
    const item = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
    if (!item) { sendError(res, "Item not found", 404); return; }
    if (!canAccessBranch(req, item.branchId)) { sendError(res, "Item not found", 404); return; }

    const request = await prisma.inventoryPurchaseRequest.create({
      data: { itemId, vendor, quantity, estimatedCost, reason, requestedBy: req.user!.userId, stage: "INCHARGE_REQUESTED" },
    });
    sendSuccess(res, request, "Purchase request raised", 201);
  } catch (error) { sendError(res, "Failed to raise purchase request", 500, (error as Error).message); }
};

export const advanceInventoryPurchaseRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { decision, rejectionReason, billNo, billDate } = req.body;

    const request = await prisma.inventoryPurchaseRequest.findUnique({ where: { id }, include: { item: true } });
    if (!request) { sendError(res, "Purchase request not found", 404); return; }
    if (!canAccessBranch(req, request.item.branchId)) { sendError(res, "Purchase request not found", 404); return; }

    if (decision === "REJECT") {
      const updated = await prisma.inventoryPurchaseRequest.update({ where: { id }, data: { stage: "REJECTED", rejectionReason } });
      sendSuccess(res, updated, "Purchase request rejected");
      return;
    }

    const approverId = req.user!.userId;
    const stageMap: Record<string, any> = {
      INCHARGE_REQUESTED: { stage: "MANAGER_APPROVED", managerApprovedBy: approverId, managerApprovedAt: new Date() },
      MANAGER_APPROVED: { stage: "ACCOUNTS_APPROVED", accountsApprovedBy: approverId, accountsApprovedAt: new Date() },
      ACCOUNTS_APPROVED: { stage: "DIRECTOR_APPROVED", directorApprovedBy: approverId, directorApprovedAt: new Date() },
    };
    const nextData = stageMap[request.stage];
    if (!nextData) { sendError(res, "This request has already completed its approval chain", 400); return; }

    let updated = await prisma.inventoryPurchaseRequest.update({ where: { id }, data: nextData });

    // Once fully Director-approved, actually create the
    // InventoryPurchase ledger row and apply the stock increment
    // (mirrors purchaseStock below).
    if (updated.stage === "DIRECTOR_APPROVED") {
      const purchase = await prisma.inventoryPurchase.create({
        data: {
          itemId: request.itemId, vendor: request.vendor, quantity: request.quantity,
          rate: Number(request.estimatedCost) / request.quantity, totalCost: request.estimatedCost,
          billNo, billDate: billDate ? new Date(billDate) : null,
        },
      });
      await prisma.inventoryItem.update({ where: { id: request.itemId }, data: { currentStock: { increment: request.quantity } } });
      updated = await prisma.inventoryPurchaseRequest.update({ where: { id }, data: { resultingPurchaseId: purchase.id } });
    }

    sendSuccess(res, updated, `Purchase request advanced to ${updated.stage}`);
  } catch (error) { sendError(res, "Failed to advance purchase request", 500, (error as Error).message); }
};

export const getInventoryPurchaseRequests = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    const requests = await prisma.inventoryPurchaseRequest.findMany({
      where: { item: { branchId } },
      include: { item: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    sendSuccess(res, requests, "Inventory purchase requests fetched");
  } catch (error) { sendError(res, "Failed to fetch purchase requests", 500, (error as Error).message); }
};

/**
 * AMC/warranty expiry reminders (spec Section 17 - "full auto-
 * reminders/alerts"). Returns every appliance item whose
 * warrantyExpiry or amcExpiry falls within the next 30 days (or has
 * already passed) - polled by the frontend, same convention as Lab's
 * getExpiringConsumables (no scheduled-job infra exists in this
 * codebase for a push-style reminder yet).
 */
export const getApplianceExpiryAlerts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    if (!branchId) { sendError(res, "Branch ID required", 400); return; }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 30);

    const items = await prisma.inventoryItem.findMany({
      where: {
        branchId, isAppliance: true,
        OR: [{ warrantyExpiry: { lte: cutoff } }, { amcExpiry: { lte: cutoff } }],
      },
      orderBy: { warrantyExpiry: "asc" },
    });
    sendSuccess(res, items, "Appliance expiry alerts fetched");
  } catch (error) { sendError(res, "Failed to fetch appliance expiry alerts", 500, (error as Error).message); }
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
    const { itemId, issuedTo, quantity, purpose, isReturnable } = req.body;
    const item = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
    if (!item || item.currentStock < quantity) { sendError(res, "Insufficient stock", 400); return; }

    const issue = await prisma.inventoryIssue.create({
      data: { itemId, issuedTo, quantity, purpose, issuedBy: req.user!.userId, isReturnable: !!isReturnable },
    });
    await prisma.inventoryItem.update({ where: { id: itemId }, data: { currentStock: { decrement: quantity } } });
    sendSuccess(res, issue, "Stock issued", 201);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Marks a previously-issued RETURNABLE item as returned (spec Section
 * 17 - "return status if returnable"). Does NOT automatically add the
 * quantity back to currentStock - a returned asset (e.g. a projector)
 * isn't fungible "stock" the same way consumables are; re-issuing it
 * is just creating a fresh InventoryIssue row referencing the same
 * item, not incrementing a count.
 */
export const returnIssuedStock = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { returnCondition } = req.body;

    const issue = await prisma.inventoryIssue.findUnique({ where: { id }, include: { item: true } });
    if (!issue) { sendError(res, "Issue record not found", 404); return; }
    if (!canAccessBranch(req, issue.item.branchId)) { sendError(res, "Issue record not found", 404); return; }
    if (!issue.isReturnable) { sendError(res, "This item was not issued as returnable", 400); return; }
    if (issue.returnedAt) { sendError(res, "This item has already been marked as returned", 400); return; }

    const updated = await prisma.inventoryIssue.update({ where: { id }, data: { returnedAt: new Date(), returnCondition } });
    sendSuccess(res, updated, "Item marked as returned");
  } catch (error) { sendError(res, "Failed to mark item as returned", 500, (error as Error).message); }
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
