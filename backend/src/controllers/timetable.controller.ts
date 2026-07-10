import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";

/**
 * Create/get timetable for a section
 */
export const getOrCreateTimetable = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { sectionId, classId, academicYearId } = req.body;

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
 */
export const getTeacherTimetable = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { teacherId } = req.params;

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
