import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { resolveBranchId, resolveEffectiveBranchId, canAccessBranch } from "../utils/branchScope";

/**
 * Canteen Module (spec Section 15) - full stock inventory (separate
 * from the school-wide InventoryItem, see CanteenItem's doc comment in
 * schema.prisma), both prepaid-wallet (RFID) and cash/counter billing,
 * wallet recharge by parent or student (online or cash-at-counter),
 * and a stock-replenish approval chain identical in shape to
 * DieselRequest/InventoryPurchaseRequest.
 */

export const addCanteenItem = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, category, unit, price, minStock, rackNo, counterNo } = req.body;
    const branchId = resolveEffectiveBranchId(req, req.body.branchId);
    if (!branchId) { sendError(res, "Branch ID could not be resolved", 400); return; }
    if (!canAccessBranch(req, branchId)) { sendError(res, "Access denied", 403); return; }

    const item = await prisma.canteenItem.create({
      data: { branchId, name, category, unit, price, minStock: minStock ?? 5, rackNo, counterNo },
    });
    sendSuccess(res, item, "Canteen item added", 201);
  } catch (error) { sendError(res, "Failed to add canteen item", 500, (error as Error).message); }
};

export const getCanteenItems = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    const items = await prisma.canteenItem.findMany({ where: { branchId }, orderBy: { name: "asc" } });
    sendSuccess(res, items, "Canteen items fetched");
  } catch (error) { sendError(res, "Failed to fetch canteen items", 500, (error as Error).message); }
};

/**
 * Wallet recharge (spec Section 15) - online or cash-at-counter,
 * initiated by parent or student themselves. Creates the wallet on
 * first recharge if it doesn't exist yet.
 */
export const rechargeWallet = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { studentId, amount, rechargeMode } = req.body;

    const student = await prisma.student.findUnique({ where: { id: studentId }, select: { branchId: true } });
    if (!student) { sendError(res, "Student not found", 404); return; }
    if (!canAccessBranch(req, student.branchId)) { sendError(res, "Student not found", 404); return; }

    const wallet = await prisma.canteenWallet.upsert({
      where: { studentId },
      update: { balance: { increment: amount } },
      create: { studentId, branchId: student.branchId, balance: amount },
    });

    await prisma.canteenWalletTransaction.create({
      data: { walletId: wallet.id, type: "RECHARGE", amount, rechargeMode, initiatedBy: req.user!.userId },
    });

    sendSuccess(res, wallet, "Wallet recharged", 201);
  } catch (error) { sendError(res, "Failed to recharge wallet", 500, (error as Error).message); }
};

export const getWallet = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { studentId } = req.params;
    const student = await prisma.student.findUnique({ where: { id: studentId }, select: { branchId: true } });
    if (!student) { sendError(res, "Student not found", 404); return; }
    if (!canAccessBranch(req, student.branchId)) { sendError(res, "Student not found", 404); return; }

    const wallet = await prisma.canteenWallet.findUnique({
      where: { studentId },
      include: { transactions: { orderBy: { createdAt: "desc" }, take: 50 } },
    });
    sendSuccess(res, wallet, "Wallet fetched");
  } catch (error) { sendError(res, "Failed to fetch wallet", 500, (error as Error).message); }
};

/**
 * A counter sale - supports BOTH wallet debit and cash payment (spec
 * Section 15). Decrements stock for every line item and, for a WALLET
 * sale, debits the student's balance (blocked if insufficient) and
 * logs a PURCHASE wallet transaction.
 */
export const createCanteenSale = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { studentId, items, paymentMode } = req.body; // items: [{itemId, quantity}]
    const branchId = resolveEffectiveBranchId(req, req.body.branchId);
    if (!branchId) { sendError(res, "Branch ID could not be resolved", 400); return; }
    if (!canAccessBranch(req, branchId)) { sendError(res, "Access denied", 403); return; }

    const itemIds = items.map((i: any) => i.itemId);
    const canteenItems = await prisma.canteenItem.findMany({ where: { id: { in: itemIds }, branchId } });
    if (canteenItems.length !== itemIds.length) { sendError(res, "One or more items not found in this branch", 404); return; }

    const itemById = new Map(canteenItems.map((i) => [i.id, i]));
    for (const line of items) {
      const item = itemById.get(line.itemId)!;
      if (item.currentStock < line.quantity) {
        sendError(res, `Insufficient stock for ${item.name} (available: ${item.currentStock})`, 400);
        return;
      }
    }

    const totalAmount = items.reduce((sum: number, line: any) => sum + Number(itemById.get(line.itemId)!.price) * line.quantity, 0);

    let wallet = null;
    if (paymentMode === "WALLET") {
      if (!studentId) { sendError(res, "studentId is required for a wallet payment", 400); return; }
      wallet = await prisma.canteenWallet.findUnique({ where: { studentId } });
      if (!wallet || Number(wallet.balance) < totalAmount) {
        sendError(res, "Insufficient wallet balance", 400);
        return;
      }
    }

    const sale = await prisma.$transaction(async (tx) => {
      const createdSale = await tx.canteenSale.create({
        data: {
          branchId, studentId: studentId || null, totalAmount, paymentMode, soldBy: req.user!.userId,
          items: {
            create: items.map((line: any) => ({
              itemId: line.itemId, quantity: line.quantity,
              rate: itemById.get(line.itemId)!.price,
              subtotal: Number(itemById.get(line.itemId)!.price) * line.quantity,
            })),
          },
        },
        include: { items: true },
      });

      for (const line of items) {
        await tx.canteenItem.update({ where: { id: line.itemId }, data: { currentStock: { decrement: line.quantity } } });
      }

      if (paymentMode === "WALLET" && wallet) {
        await tx.canteenWallet.update({ where: { id: wallet.id }, data: { balance: { decrement: totalAmount } } });
        await tx.canteenWalletTransaction.create({
          data: { walletId: wallet.id, type: "PURCHASE", amount: totalAmount, saleId: createdSale.id },
        });
      }

      return createdSale;
    });

    sendSuccess(res, sale, "Sale recorded", 201);
  } catch (error) { sendError(res, "Failed to record sale", 500, (error as Error).message); }
};

/**
 * Stock replenish approval chain (spec Section 15 - same flow as
 * diesel: Incharge -> Manager -> Accounts -> Director payment
 * approval), reusing the shared ApprovalChainStage enum.
 */
export const raiseCanteenStockRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { itemId, vendor, quantity, estimatedCost } = req.body;
    const item = await prisma.canteenItem.findUnique({ where: { id: itemId } });
    if (!item) { sendError(res, "Item not found", 404); return; }
    if (!canAccessBranch(req, item.branchId)) { sendError(res, "Item not found", 404); return; }

    const request = await prisma.canteenStockRequest.create({
      data: { itemId, vendor, quantity, estimatedCost, requestedBy: req.user!.userId, stage: "INCHARGE_REQUESTED" },
    });
    sendSuccess(res, request, "Stock request raised", 201);
  } catch (error) { sendError(res, "Failed to raise stock request", 500, (error as Error).message); }
};

export const advanceCanteenStockRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { decision, rejectionReason } = req.body;

    const request = await prisma.canteenStockRequest.findUnique({ where: { id }, include: { item: true } });
    if (!request) { sendError(res, "Stock request not found", 404); return; }
    if (!canAccessBranch(req, request.item.branchId)) { sendError(res, "Stock request not found", 404); return; }

    if (decision === "REJECT") {
      const updated = await prisma.canteenStockRequest.update({ where: { id }, data: { stage: "REJECTED", rejectionReason } });
      sendSuccess(res, updated, "Stock request rejected");
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

    let updated = await prisma.canteenStockRequest.update({ where: { id }, data: nextData });

    // Once fully Director-approved, apply the stock increment
    // immediately (mirrors InventoryPurchase's role for
    // InventoryPurchaseRequest).
    if (updated.stage === "DIRECTOR_APPROVED") {
      await prisma.canteenItem.update({ where: { id: request.itemId }, data: { currentStock: { increment: request.quantity } } });
    }

    sendSuccess(res, updated, `Stock request advanced to ${updated.stage}`);
  } catch (error) { sendError(res, "Failed to advance stock request", 500, (error as Error).message); }
};

export const getCanteenStockRequests = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    const requests = await prisma.canteenStockRequest.findMany({
      where: { item: { branchId } },
      include: { item: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    sendSuccess(res, requests, "Canteen stock requests fetched");
  } catch (error) { sendError(res, "Failed to fetch stock requests", 500, (error as Error).message); }
};
