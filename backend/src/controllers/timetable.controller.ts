import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { canAccessBranch } from "../utils/branchScope";

/**
 * Create/get timetable for a section
 */
export const getOrCreateTimetable = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { sectionId, classId, academicYearId } = req.body;

    // BUG FIX: Timetable.academicYearId is a required (non-nullable)
    // relation - if the caller has no academic year marked "active"
    // yet, the frontend sent `academicYearId: undefined`, Prisma threw
    // a foreign-key/validation error, and the frontend's `catch {}`
    // block swallowed it completely (no alert, nothing) - the page
    // just silently showed "No timetable found" forever, with zero
    // indication of why. Return a clear, actionable 400 instead.
    if (!sectionId || !classId) {
      sendError(res, "sectionId and classId are required", 400);
      return;
    }
    if (!academicYearId) {
      sendError(res, "No active academic year found. Set an academic year as active first (Dashboard > Academic Years).", 400);
      return;
    }

    let timetable = await prisma.timetable.findUnique({ where: { sectionId } });
    if (!timetable) {
      timetable = await prisma.timetable.create({
        data: { sectionId, classId, academicYearId },
      });
    }

    const full = await prisma.timetable.findUnique({
      where: { id: timetable.id },
      include: {
        slots: {
          include: { teacher: { include: { user: { select: { name: true } } } } },
          orderBy: [{ day: "asc" }, { period: "asc" }],
        },
        section: { select: { name: true } },
        class: { select: { name: true } },
      },
    });

    sendSuccess(res, full, "Timetable fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Add/update timetable slot
 */
export const upsertSlot = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { timetableId, day, period, subjectId, teacherId, startTime, endTime, isBreak } = req.body;

    // Conflict check: same teacher at same day+period in another class
    if (teacherId && !isBreak) {
      const conflict = await prisma.timetableSlot.findFirst({
        where: { day, period, teacherId, timetableId: { not: timetableId } },
        include: { timetable: { include: { class: { select: { name: true } }, section: { select: { name: true } } } } },
      });
      if (conflict) {
        sendError(res, `Conflict: Teacher already assigned to ${conflict.timetable.class.name}-${conflict.timetable.section.name} at this time`, 400);
        return;
      }
    }

    const existing = await prisma.timetableSlot.findUnique({
      where: { timetableId_day_period: { timetableId, day, period } },
    });

    if (existing) {
      const updated = await prisma.timetableSlot.update({
        where: { id: existing.id },
        data: { subjectId, teacherId, startTime, endTime, isBreak: isBreak || false },
      });
      sendSuccess(res, updated, "Slot updated");
    } else {
      const slot = await prisma.timetableSlot.create({
        data: { timetableId, day, period, subjectId, teacherId, startTime, endTime, isBreak: isBreak || false },
      });
      sendSuccess(res, slot, "Slot created", 201);
    }
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Get teacher's timetable
 *
 * SECURITY FIX: this previously had no access check at all beyond the
 * route's `authenticate` - any authenticated user of any role (a
 * Student, a Parent, a Teacher in a completely different branch)
 * could pass an arbitrary `teacherId` and read that teacher's full
 * weekly schedule (which classes/sections/subjects they teach and
 * when), an IDOR with no ownership or branch check whatsoever. Fixed
 * by resolving the teacher's own branch through their Staff record
 * and requiring the caller to either be that same teacher, or have
 * branch access to it (Super Admin, or a Branch/Staff member of that
 * same branch) - the same ownership-or-branch-access shape already
 * used by canAccessStaffRecord for other staff-scoped endpoints.
 */
export const getTeacherTimetable = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { teacherId } = req.params;

    const teacher = await prisma.staff.findUnique({
      where: { id: teacherId },
      select: { branchId: true, userId: true },
    });
    if (!teacher) { sendError(res, "Teacher not found", 404); return; }

    const isSelf = teacher.userId === req.user?.userId;
    if (!isSelf && !canAccessBranch(req, teacher.branchId)) {
      sendError(res, "Teacher not found", 404);
      return;
    }

    const slots = await prisma.timetableSlot.findMany({
      where: { teacherId },
      include: {
        timetable: { include: { class: { select: { name: true } }, section: { select: { name: true } } } },
      },
      orderBy: [{ day: "asc" }, { period: "asc" }],
    });

    sendSuccess(res, slots, "Teacher timetable fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Delete a slot
 */
export const deleteSlot = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    await prisma.timetableSlot.delete({ where: { id } });
    sendSuccess(res, null, "Slot deleted");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};
