import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { resolveBranchId, resolveEffectiveBranchId, canAccessBranch } from "../utils/branchScope";

/**
 * Lab Management Module (spec Section 16, higher-class labs) -
 * equipment issue (group or individual), damage/breakage fine
 * (Principal-waivable), and chemical/consumable expiry alerts.
 */

export const addLabEquipment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, category, totalQuantity, isConsumable, expiryDate } = req.body;
    const branchId = resolveEffectiveBranchId(req, req.body.branchId);
    if (!branchId) { sendError(res, "Branch ID could not be resolved", 400); return; }
    if (!canAccessBranch(req, branchId)) { sendError(res, "Access denied", 403); return; }

    const equipment = await prisma.labEquipment.create({
      data: {
        branchId, name, category, totalQuantity: totalQuantity ?? 1, availableQuantity: totalQuantity ?? 1,
        isConsumable: !!isConsumable, expiryDate: expiryDate ? new Date(expiryDate) : null,
      },
    });
    sendSuccess(res, equipment, "Lab equipment added", 201);
  } catch (error) { sendError(res, "Failed to add lab equipment", 500, (error as Error).message); }
};

export const getLabEquipment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    const equipment = await prisma.labEquipment.findMany({ where: { branchId }, orderBy: { name: "asc" } });
    sendSuccess(res, equipment, "Lab equipment fetched");
  } catch (error) { sendError(res, "Failed to fetch lab equipment", 500, (error as Error).message); }
};

/**
 * Equipment issue - supports BOTH group and individual issue (spec
 * Section 16). Exactly one of groupLabel / studentId / staffId should
 * typically be meaningful, but this isn't hard-enforced since a group
 * issue may still want a representative receiver recorded (see the
 * LabEquipmentIssue model's doc comment).
 */
export const issueLabEquipment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { equipmentId, quantity, groupLabel, studentId, staffId } = req.body;

    const equipment = await prisma.labEquipment.findUnique({ where: { id: equipmentId } });
    if (!equipment) { sendError(res, "Equipment not found", 404); return; }
    if (!canAccessBranch(req, equipment.branchId)) { sendError(res, "Equipment not found", 404); return; }
    if (equipment.availableQuantity < quantity) {
      sendError(res, `Insufficient available quantity (available: ${equipment.availableQuantity})`, 400);
      return;
    }

    const [issue] = await prisma.$transaction([
      prisma.labEquipmentIssue.create({
        data: { equipmentId, quantity, groupLabel, studentId, staffId, issuedBy: req.user!.userId, status: "ISSUED" },
      }),
      prisma.labEquipment.update({ where: { id: equipmentId }, data: { availableQuantity: { decrement: quantity } } }),
    ]);
    sendSuccess(res, issue, "Equipment issued", 201);
  } catch (error) { sendError(res, "Failed to issue equipment", 500, (error as Error).message); }
};

/**
 * Return equipment - optionally flags damage/breakage with a fine
 * (spec Section 16 - "added by Lab Assistant"). A LOST item never
 * returns to available stock; a DAMAGED item currently also doesn't
 * (repair/write-off is a manual follow-up outside this flow, same as
 * LibraryIssue's LOST/DAMAGED handling).
 */
export const returnLabEquipment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, damageFine } = req.body; // status: "RETURNED" | "DAMAGED" | "LOST"

    const issue = await prisma.labEquipmentIssue.findUnique({ where: { id }, include: { equipment: true } });
    if (!issue) { sendError(res, "Issue record not found", 404); return; }
    if (!canAccessBranch(req, issue.equipment.branchId)) { sendError(res, "Issue record not found", 404); return; }
    if (issue.status !== "ISSUED") { sendError(res, "This item has already been returned/resolved", 400); return; }

    const updated = await prisma.labEquipmentIssue.update({
      where: { id },
      data: { status, returnDate: new Date(), damageFine: damageFine || 0 },
    });

    if (status === "RETURNED") {
      await prisma.labEquipment.update({ where: { id: issue.equipmentId }, data: { availableQuantity: { increment: issue.quantity } } });
    } else {
      // DAMAGED/LOST - permanently reduces total stock.
      await prisma.labEquipment.update({ where: { id: issue.equipmentId }, data: { totalQuantity: { decrement: issue.quantity } } });
    }

    sendSuccess(res, updated, `Equipment marked ${status.toLowerCase()}`);
  } catch (error) { sendError(res, "Failed to return equipment", 500, (error as Error).message); }
};

/**
 * Damage/breakage fine waiver (spec Section 16 - "waivable by
 * Principal"). Restricted at the route level to PRINCIPAL/ADMIN roles.
 */
export const waiveLabDamageFine = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { waivedAmount } = req.body;

    const issue = await prisma.labEquipmentIssue.findUnique({ where: { id }, include: { equipment: true } });
    if (!issue) { sendError(res, "Issue record not found", 404); return; }
    if (!canAccessBranch(req, issue.equipment.branchId)) { sendError(res, "Issue record not found", 404); return; }

    const cappedWaiver = Math.min(Number(waivedAmount), Number(issue.damageFine));
    const updated = await prisma.labEquipmentIssue.update({
      where: { id },
      data: { damageFineWaived: cappedWaiver, damageFineWaivedBy: req.user!.userId },
    });
    sendSuccess(res, updated, "Damage fine waived");
  } catch (error) { sendError(res, "Failed to waive damage fine", 500, (error as Error).message); }
};

/**
 * Chemical/consumable expiry alert (spec Section 16 - "auto-alert
 * required before expiry"). Returns everything expiring within the
 * next 30 days (or already expired) - a dedicated endpoint rather
 * than a background job/notification for this iteration, since no
 * scheduled-job infrastructure exists elsewhere in this codebase
 * either; the frontend polls this on the Lab dashboard.
 */
export const getExpiringConsumables = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    if (!branchId) { sendError(res, "Branch ID required", 400); return; }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 30);

    const expiring = await prisma.labEquipment.findMany({
      where: { branchId, isConsumable: true, expiryDate: { lte: cutoff } },
      orderBy: { expiryDate: "asc" },
    });
    sendSuccess(res, expiring, "Expiring/expired consumables fetched");
  } catch (error) { sendError(res, "Failed to fetch expiring consumables", 500, (error as Error).message); }
};
