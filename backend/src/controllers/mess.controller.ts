import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { resolveBranchId, resolveEffectiveBranchId, canAccessBranch } from "../utils/branchScope";

/**
 * Mess Module (spec Section 14) - week-wise veg/non-veg meal plan,
 * monthly-fixed billing (not per-meal-consumed), Principal/leave-based
 * waivers, a 4-stage menu approval chain, and guest meal logging
 * (parents free, others chargeable).
 */

export const upsertMessMenu = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { dayOfWeek, mealType, vegOption, nonVegOption } = req.body;
    const branchId = resolveEffectiveBranchId(req, req.body.branchId);
    if (!branchId) { sendError(res, "Branch ID could not be resolved", 400); return; }
    if (!canAccessBranch(req, branchId)) { sendError(res, "Access denied", 403); return; }

    const menu = await prisma.messMenu.upsert({
      where: { branchId_dayOfWeek_mealType: { branchId, dayOfWeek, mealType } },
      // Editing an existing (already-approved) menu resets it back to
      // the start of the approval chain - a changed menu needs
      // re-approval, it can't silently stay "Director approved" for
      // different food than what was actually approved.
      update: { vegOption, nonVegOption, approvalStage: "INCHARGE_DRAFTED", wardenApprovedBy: null, wardenApprovedAt: null, principalApprovedBy: null, principalApprovedAt: null, directorApprovedBy: null, directorApprovedAt: null },
      create: { branchId, dayOfWeek, mealType, vegOption, nonVegOption, approvalStage: "INCHARGE_DRAFTED" },
    });
    sendSuccess(res, menu, "Menu saved - pending approval chain (Warden -> Principal -> Director)", 201);
  } catch (error) { sendError(res, "Failed to save menu", 500, (error as Error).message); }
};

export const getMessMenus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    const menus = await prisma.messMenu.findMany({
      where: { branchId },
      orderBy: [{ dayOfWeek: "asc" }, { mealType: "asc" }],
    });
    sendSuccess(res, menus, "Mess menus fetched");
  } catch (error) { sendError(res, "Failed to fetch menus", 500, (error as Error).message); }
};

/**
 * Menu approval chain (spec Section 14): Mess Incharge -> Warden ->
 * Principal -> Director, each stage advanced by the appropriate role
 * (enforced at the route level via authorize; this controller just
 * advances the stage sequentially without re-checking WHICH specific
 * role called it beyond the route's own gate, matching the pattern
 * used by DieselRequest/CanteenStockRequest's chain advancement).
 */
export const advanceMenuApproval = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { decision } = req.body;

    const menu = await prisma.messMenu.findUnique({ where: { id } });
    if (!menu) { sendError(res, "Menu not found", 404); return; }
    if (!canAccessBranch(req, menu.branchId)) { sendError(res, "Menu not found", 404); return; }

    if (decision === "REJECT") {
      const updated = await prisma.messMenu.update({ where: { id }, data: { approvalStage: "REJECTED" } });
      sendSuccess(res, updated, "Menu rejected");
      return;
    }

    const approverId = req.user!.userId;
    const stageMap: Record<string, any> = {
      INCHARGE_DRAFTED: { approvalStage: "WARDEN_APPROVED", wardenApprovedBy: approverId, wardenApprovedAt: new Date() },
      WARDEN_APPROVED: { approvalStage: "PRINCIPAL_APPROVED", principalApprovedBy: approverId, principalApprovedAt: new Date() },
      PRINCIPAL_APPROVED: { approvalStage: "DIRECTOR_APPROVED", directorApprovedBy: approverId, directorApprovedAt: new Date() },
    };
    const nextData = stageMap[menu.approvalStage];
    if (!nextData) {
      sendError(res, "This menu has already completed its approval chain (or was rejected)", 400);
      return;
    }
    const updated = await prisma.messMenu.update({ where: { id }, data: nextData });
    sendSuccess(res, updated, `Menu advanced to ${updated.approvalStage}`);
  } catch (error) { sendError(res, "Failed to advance menu approval", 500, (error as Error).message); }
};

/**
 * Monthly fixed bill (spec Section 14 - "not per-meal-consumed") for
 * one student's hostel mess charges.
 */
export const generateMessBill = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { studentId, month, year, amount } = req.body;
    const branchId = resolveEffectiveBranchId(req, req.body.branchId);
    if (!branchId) { sendError(res, "Branch ID could not be resolved", 400); return; }
    if (!canAccessBranch(req, branchId)) { sendError(res, "Access denied", 403); return; }

    const student = await prisma.student.findUnique({ where: { id: studentId }, select: { branchId: true } });
    if (!student || student.branchId !== branchId) { sendError(res, "Student not found in this branch", 404); return; }

    const bill = await prisma.messBill.upsert({
      where: { studentId_month_year: { studentId, month, year } },
      update: { amount },
      create: { branchId, studentId, month, year, amount, status: "PENDING" },
    });
    sendSuccess(res, bill, "Mess bill generated", 201);
  } catch (error) { sendError(res, "Failed to generate mess bill", 500, (error as Error).message); }
};

export const getMessBills = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    const studentId = req.query.studentId as string | undefined;
    const where: any = { branchId };
    if (studentId) where.studentId = studentId;

    const bills = await prisma.messBill.findMany({
      where,
      include: { },
      orderBy: [{ year: "desc" }, { month: "desc" }],
    });
    sendSuccess(res, bills, "Mess bills fetched");
  } catch (error) { sendError(res, "Failed to fetch mess bills", 500, (error as Error).message); }
};

/**
 * Bill waiver (spec Section 14) - by Principal directly, OR via a
 * Warden-approved leave covering the billing period (both grounds are
 * independent and can coexist).
 */
export const waiveMessBill = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { waivedAmount, waivedViaLeaveApplicationId } = req.body;

    const bill = await prisma.messBill.findUnique({ where: { id } });
    if (!bill) { sendError(res, "Bill not found", 404); return; }
    if (!canAccessBranch(req, bill.branchId)) { sendError(res, "Bill not found", 404); return; }

    const cappedWaiver = Math.min(Number(waivedAmount), Number(bill.amount));
    const updated = await prisma.messBill.update({
      where: { id },
      data: {
        waivedAmount: cappedWaiver,
        waivedByPrincipal: waivedViaLeaveApplicationId ? bill.waivedByPrincipal : req.user!.userId,
        waivedViaLeaveApplicationId,
        status: cappedWaiver >= Number(bill.amount) ? "WAIVED" : bill.status,
      },
    });
    sendSuccess(res, updated, "Mess bill waived");
  } catch (error) { sendError(res, "Failed to waive mess bill", 500, (error as Error).message); }
};

export const payMessBill = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const bill = await prisma.messBill.findUnique({ where: { id } });
    if (!bill) { sendError(res, "Bill not found", 404); return; }
    if (!canAccessBranch(req, bill.branchId)) { sendError(res, "Bill not found", 404); return; }

    const updated = await prisma.messBill.update({ where: { id }, data: { status: "PAID", paidAt: new Date() } });
    sendSuccess(res, updated, "Mess bill marked as paid");
  } catch (error) { sendError(res, "Failed to mark mess bill paid", 500, (error as Error).message); }
};

/**
 * Guest meal log (spec Section 14) - parents eat free (chargeAmount
 * forced to 0), other guests are chargeable per meal.
 */
export const logGuestMeal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { guestName, isParent, relatedStudentId, mealType, chargeAmount } = req.body;
    const branchId = resolveEffectiveBranchId(req, req.body.branchId);
    if (!branchId) { sendError(res, "Branch ID could not be resolved", 400); return; }
    if (!canAccessBranch(req, branchId)) { sendError(res, "Access denied", 403); return; }

    const meal = await prisma.messGuestMeal.create({
      data: {
        branchId, guestName, isParent: !!isParent, relatedStudentId, mealType,
        chargeAmount: isParent ? 0 : (chargeAmount || 0),
        loggedBy: req.user!.userId,
      },
    });
    sendSuccess(res, meal, "Guest meal logged", 201);
  } catch (error) { sendError(res, "Failed to log guest meal", 500, (error as Error).message); }
};

export const getGuestMeals = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    const meals = await prisma.messGuestMeal.findMany({ where: { branchId }, orderBy: { mealDate: "desc" } });
    sendSuccess(res, meals, "Guest meals fetched");
  } catch (error) { sendError(res, "Failed to fetch guest meals", 500, (error as Error).message); }
};
