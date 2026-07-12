import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { resolveBranchId, resolveEffectiveBranchId, canAccessBranch } from "../utils/branchScope";

/**
 * Declared non-working days for a branch (see schema's Holiday model
 * doc comment) - so attendance reports can exclude these dates from
 * the "should have been present" denominator instead of wrongly
 * implying absence on a day nobody was expected in.
 */

export const getHolidays = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    const { year } = req.query;

    const where: any = { branchId };
    if (year) {
      const y = parseInt(year as string, 10);
      where.date = { gte: new Date(y, 0, 1), lte: new Date(y, 11, 31, 23, 59, 59) };
    }

    const holidays = await prisma.holiday.findMany({ where, orderBy: { date: "asc" } });
    sendSuccess(res, holidays, "Holidays fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

export const createHoliday = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { date, name } = req.body;
    const branchId = resolveEffectiveBranchId(req, req.body.branchId);

    if (!branchId) { sendError(res, "Branch ID could not be resolved", 400); return; }
    if (!canAccessBranch(req, branchId)) { sendError(res, "Access denied", 403); return; }

    const existing = await prisma.holiday.findUnique({ where: { branchId_date: { branchId, date: new Date(date) } } });
    if (existing) { sendError(res, "A holiday is already declared for this date", 400); return; }

    const holiday = await prisma.holiday.create({ data: { branchId, date: new Date(date), name } });
    sendSuccess(res, holiday, "Holiday added", 201);
  } catch (error) { sendError(res, "Failed to add holiday", 500, (error as Error).message); }
};

export const deleteHoliday = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const holiday = await prisma.holiday.findUnique({ where: { id } });
    if (!holiday) { sendError(res, "Holiday not found", 404); return; }
    if (!canAccessBranch(req, holiday.branchId)) { sendError(res, "Holiday not found", 404); return; }

    await prisma.holiday.delete({ where: { id } });
    sendSuccess(res, null, "Holiday deleted");
  } catch (error) { sendError(res, "Failed to delete holiday", 500, (error as Error).message); }
};
