import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";

/**
 * Grade System (grading scale) management.
 *
 * `GradeSystem` bands (e.g. CBSE's A1: 91-100, A2: 81-90, ...) are a
 * single, system-wide scale - the schema has no `branchId` on this
 * model, same as `LeaveType` - so these endpoints are ADMIN-only
 * (SUPER_ADMIN/BRANCH_ADMIN) rather than branch-scoped like most other
 * controllers in this codebase.
 */

/**
 * List all grade bands, ordered by their mark range (lowest first) so
 * the settings-page table reads naturally top-to-bottom.
 */
export const getGradeBands = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const bands = await prisma.gradeSystem.findMany({ orderBy: { minMarks: "asc" } });
    sendSuccess(res, bands, "Grade bands fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * A new/updated band's [minMarks, maxMarks) range must not overlap any
 * other existing band - otherwise a single mark percentage could match
 * two different grades, which would make `lookupGrade` (and any future
 * auto-grade wiring into enterMarks) ambiguous. `excludeId` lets update
 * skip comparing the band against itself.
 */
const findOverlappingBand = async (minMarks: number, maxMarks: number, excludeId?: string) => {
  return prisma.gradeSystem.findFirst({
    where: {
      ...(excludeId && { id: { not: excludeId } }),
      minMarks: { lt: maxMarks },
      maxMarks: { gt: minMarks },
    },
  });
};

export const createGradeBand = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, minMarks, maxMarks, grade, gradePoint } = req.body;

    const overlap = await findOverlappingBand(minMarks, maxMarks);
    if (overlap) {
      sendError(res, `Range overlaps existing band "${overlap.grade}" (${overlap.minMarks}-${overlap.maxMarks})`, 400);
      return;
    }

    const band = await prisma.gradeSystem.create({
      data: { name, minMarks, maxMarks, grade, gradePoint: gradePoint ?? null },
    });
    sendSuccess(res, band, "Grade band created", 201);
  } catch (error) { sendError(res, "Failed to create grade band", 500, (error as Error).message); }
};

export const updateGradeBand = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, minMarks, maxMarks, grade, gradePoint } = req.body;

    const existing = await prisma.gradeSystem.findUnique({ where: { id } });
    if (!existing) { sendError(res, "Grade band not found", 404); return; }

    const nextMin = minMarks !== undefined ? minMarks : Number(existing.minMarks);
    const nextMax = maxMarks !== undefined ? maxMarks : Number(existing.maxMarks);
    if (minMarks !== undefined || maxMarks !== undefined) {
      const overlap = await findOverlappingBand(nextMin, nextMax, id);
      if (overlap) {
        sendError(res, `Range overlaps existing band "${overlap.grade}" (${overlap.minMarks}-${overlap.maxMarks})`, 400);
        return;
      }
    }

    const updated = await prisma.gradeSystem.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(minMarks !== undefined && { minMarks }),
        ...(maxMarks !== undefined && { maxMarks }),
        ...(grade !== undefined && { grade }),
        ...(gradePoint !== undefined && { gradePoint }),
      },
    });
    sendSuccess(res, updated, "Grade band updated");
  } catch (error) { sendError(res, "Failed to update grade band", 500, (error as Error).message); }
};

export const deleteGradeBand = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const existing = await prisma.gradeSystem.findUnique({ where: { id } });
    if (!existing) { sendError(res, "Grade band not found", 404); return; }

    await prisma.gradeSystem.delete({ where: { id } });
    sendSuccess(res, null, "Grade band deleted");
  } catch (error) { sendError(res, "Failed to delete grade band", 500, (error as Error).message); }
};
