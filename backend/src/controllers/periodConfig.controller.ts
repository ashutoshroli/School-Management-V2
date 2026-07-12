import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { resolveBranchId, resolveEffectiveBranchId, canAccessBranch } from "../utils/branchScope";

/**
 * Admin-configurable "periods per day" for a branch (see schema's
 * PeriodConfig model doc comment). The attendance-marking UI's period
 * picker shows this list, and the Timetable editor should use it for
 * consistency as well.
 */

export const getPeriodConfigs = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    const configs = await prisma.periodConfig.findMany({
      where: { branchId },
      orderBy: { periodNo: "asc" },
    });
    sendSuccess(res, configs, "Period configs fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Upsert (create or update) the whole branch's period list in one call
 * - simpler than individual CRUD per period since the admin typically
 * edits the whole "schedule" at once on the settings page, and keeping
 * partial state (e.g. "period 3 exists but 4 doesn't yet") is
 * confusing. Deletes any existing periods for this branch and replaces
 * with the new list atomically via a transaction.
 */
export const upsertPeriodConfigs = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { periods } = req.body;
    // periods: [{periodNo, label, startTime, endTime, isBreak}]

    if (!Array.isArray(periods) || periods.length === 0) {
      sendError(res, "periods must be a non-empty array", 400);
      return;
    }

    const branchId = resolveEffectiveBranchId(req, req.body.branchId);
    if (!branchId) { sendError(res, "Branch ID could not be resolved", 400); return; }
    if (!canAccessBranch(req, branchId)) { sendError(res, "Access denied", 403); return; }

    await prisma.$transaction(async (tx) => {
      await tx.periodConfig.deleteMany({ where: { branchId } });
      await tx.periodConfig.createMany({
        data: periods.map((p: any) => ({
          branchId,
          periodNo: p.periodNo,
          label: p.label || null,
          startTime: p.startTime,
          endTime: p.endTime,
          isBreak: p.isBreak || false,
        })),
      });
    });

    const result = await prisma.periodConfig.findMany({ where: { branchId }, orderBy: { periodNo: "asc" } });
    sendSuccess(res, result, "Period configs saved");
  } catch (error) { sendError(res, "Failed to save period configs", 500, (error as Error).message); }
};
