import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { canAccessBranch } from "../utils/branchScope";

/**
 * Exam Timetable ("date sheet") - per-subject date/time/duration/room/
 * maxMarks for an Exam. Exam itself only ever had one startDate/endDate
 * for the whole exam (see schema.prisma's Exam model) - this is the
 * missing per-subject schedule.
 */

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/**
 * Two time ranges on the SAME calendar date overlap if one starts
 * before the other ends, in both directions - the standard interval
 * overlap check. Two subjects on different dates never conflict
 * regardless of their times.
 */
const rangesOverlap = (aStart: number, aEnd: number, bStart: number, bEnd: number): boolean =>
  aStart < bEnd && bStart < aEnd;

/**
 * Replaces the whole exam's subject-wise schedule in one call - same
 * "edit the whole list at once" convention as
 * upsertPeriodConfigs/bulkSetSchedule elsewhere in this codebase,
 * since an exam's date sheet is normally set once, as a whole, rather
 * than one subject at a time.
 *
 * Validates:
 *  - every subjectId is actually assigned to the exam's class
 *    (ClassSubject) - can't schedule a paper for a subject this class
 *    doesn't take.
 *  - no two subjects in the SAME submitted list overlap in time on the
 *    same date (a student can't sit two papers at once).
 *  - if a roomId is given, it must belong to the exam's branch.
 */
export const bulkSetExamSchedule = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { examId, schedule } = req.body;

    const exam = await prisma.exam.findUnique({ where: { id: examId }, include: { class: { select: { id: true, branchId: true } } } });
    if (!exam) { sendError(res, "Exam not found", 404); return; }
    if (!canAccessBranch(req, exam.class.branchId)) { sendError(res, "Exam not found", 404); return; }

    const subjectIds: string[] = schedule.map((s: any) => s.subjectId);
    const uniqueSubjectIds = new Set(subjectIds);
    if (uniqueSubjectIds.size !== subjectIds.length) {
      sendError(res, "Each subject can only appear once in the schedule - use update for a single entry instead", 400);
      return;
    }

    // Check if subjects are assigned to the class
    const assignedCount = await prisma.classSubject.count({ 
      where: { classId: exam.classId, subjectId: { in: [...uniqueSubjectIds] } } 
    });
    if (assignedCount !== uniqueSubjectIds.size) {
      sendError(res, "One or more subjects are not assigned to this exam's class", 400);
      return;
    }

    // Subject names for error messages below - a raw cuid subjectId
    // in an error string (e.g. "Subject cmrhhr4jz00057ucsdsyobvs6:
    // endTime must be after startTime") tells an admin nothing about
    // WHICH row on the timetable to fix; showing the actual subject
    // name lets them find it immediately.
    const subjectNames = new Map(
      (await prisma.subject.findMany({ where: { id: { in: [...uniqueSubjectIds] } }, select: { id: true, name: true } })).map((s) => [s.id, s.name])
    );
    const subjectLabel = (subjectId: string) => subjectNames.get(subjectId) || subjectId;

    // Overlap check: group by date, then compare every pair within
    // that date's entries.
    const byDate: Record<string, { subjectId: string; start: number; end: number }[]> = {};
    for (const s of schedule) {
      const dateKey = new Date(s.examDate).toISOString().slice(0, 10);
      const start = toMinutes(s.startTime);
      const end = toMinutes(s.endTime);
      if (end <= start) {
        sendError(
          res,
          `${subjectLabel(s.subjectId)}: End Time (${s.endTime}) must be after Start Time (${s.startTime}). If this was meant to be in the afternoon/evening, double-check the End Time's AM/PM.`,
          400
        );
        return;
      }
      (byDate[dateKey] ||= []).push({ subjectId: s.subjectId, start, end });
    }
    for (const [dateKey, entries] of Object.entries(byDate)) {
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          if (rangesOverlap(entries[i].start, entries[i].end, entries[j].start, entries[j].end)) {
            sendError(res, `Schedule conflict on ${dateKey}: ${subjectLabel(entries[i].subjectId)} and ${subjectLabel(entries[j].subjectId)} overlap in time`, 400);
            return;
          }
        }
      }
    }

    // Room branch-ownership check (only for rooms actually supplied).
    const roomIds = [...new Set(schedule.map((s: any) => s.roomId).filter(Boolean))] as string[];
    if (roomIds.length > 0) {
      const rooms = await prisma.schoolRoom.findMany({
        where: { id: { in: roomIds } },
        include: { floor: { include: { building: { select: { branchId: true } } } } },
      });
      const foundIds = new Set(rooms.map((r) => r.id));
      const notFound = roomIds.filter((id) => !foundIds.has(id));
      if (notFound.length > 0) {
        sendError(res, `Room(s) not found: ${notFound.join(", ")}`, 404);
        return;
      }
      const wrongBranch = rooms.filter((r) => r.floor.building.branchId !== exam.class.branchId);
      if (wrongBranch.length > 0) {
        sendError(res, "One or more rooms do not belong to this exam's branch", 400);
        return;
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.examSchedule.deleteMany({ where: { examId } });
      await tx.examSchedule.createMany({
        data: schedule.map((s: any) => ({
          examId,
          subjectId: s.subjectId,
          examDate: new Date(s.examDate),
          startTime: s.startTime,
          endTime: s.endTime,
          durationMinutes: s.durationMinutes,
          maxMarks: s.maxMarks,
          roomId: s.roomId || null,
        })),
      });
    });

    const result = await prisma.examSchedule.findMany({
      where: { examId },
      include: { subject: { select: { id: true, name: true, code: true } }, room: { select: { id: true, roomNo: true, name: true } } },
      orderBy: [{ examDate: "asc" }, { startTime: "asc" }],
    });
    sendSuccess(res, result, "Exam schedule saved");
  } catch (error) { sendError(res, "Failed to save exam schedule", 500, (error as Error).message); }
};

/**
 * Get all exam schedules for exams the user has access to (branch-scoped).
 * This is used by the schedule list view and must be accessible without an examId.
 */
export const getExamScheduleList = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Get all exams the user has access to, then get their schedules
    const where: any = {};
    
    // Branch scoping - same logic as getExams
    if (req.user?.role !== "SUPER_ADMIN") {
      where.exam = { class: { branchId: req.user?.branchId } };
    } else if (req.user?.branchId) {
      where.exam = { class: { branchId: req.user.branchId } };
    }
    // Super Admin with no session branchId gets all schedules

    const schedules = await prisma.examSchedule.findMany({
      where,
      include: {
        exam: { 
          select: { id: true, name: true, class: { select: { id: true, name: true, branchId: true } } } 
        },
        subject: { select: { id: true, name: true, code: true } },
        room: { select: { id: true, roomNo: true, name: true } }
      },
      orderBy: [{ exam: { name: "asc" } }, { examDate: "asc" }, { startTime: "asc" }],
    });
    sendSuccess(res, schedules, "Exam schedules fetched");
  } catch (error) { sendError(res, "Failed to fetch exam schedules", 500, (error as Error).message); }
};

/**
 * The printable "date sheet" for one exam - every subject's date/time/
 * room/max marks, in chronological order.
 */
export const getExamSchedule = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { examId } = req.params;

    const exam = await prisma.exam.findUnique({ where: { id: examId }, include: { class: { select: { branchId: true } } } });
    if (!exam) { sendError(res, "Exam not found", 404); return; }
    if (!canAccessBranch(req, exam.class.branchId)) { sendError(res, "Exam not found", 404); return; }

    const schedule = await prisma.examSchedule.findMany({
      where: { examId },
      include: { subject: { select: { id: true, name: true, code: true } }, room: { select: { id: true, roomNo: true, name: true } } },
      orderBy: [{ examDate: "asc" }, { startTime: "asc" }],
    });
    sendSuccess(res, schedule, "Exam schedule fetched");
  } catch (error) { sendError(res, "Failed to fetch exam schedule", 500, (error as Error).message); }
};

/**
 * Updates a single schedule entry in place (date/time/room/marks) -
 * for a one-off correction without resending the whole exam's
 * schedule via bulkSetExamSchedule. Re-runs the same overlap check
 * against the OTHER already-saved entries for this exam.
 */
export const updateExamScheduleEntry = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { examDate, startTime, endTime, durationMinutes, maxMarks, roomId } = req.body;

    const entry = await prisma.examSchedule.findUnique({
      where: { id },
      include: { exam: { include: { class: { select: { branchId: true } } } } },
    });
    if (!entry) { sendError(res, "Schedule entry not found", 404); return; }
    if (!canAccessBranch(req, entry.exam.class.branchId)) { sendError(res, "Schedule entry not found", 404); return; }

    const newDate = examDate !== undefined ? new Date(examDate) : entry.examDate;
    const newStart = startTime !== undefined ? startTime : entry.startTime;
    const newEnd = endTime !== undefined ? endTime : entry.endTime;
    if (toMinutes(newEnd) <= toMinutes(newStart)) {
      sendError(
        res,
        `End Time (${newEnd}) must be after Start Time (${newStart}). If this was meant to be in the afternoon/evening, double-check the End Time's AM/PM.`,
        400
      );
      return;
    }

    const siblings = await prisma.examSchedule.findMany({ where: { examId: entry.examId, id: { not: id } } });
    const newDateKey = newDate.toISOString().slice(0, 10);
    for (const sib of siblings) {
      if (sib.examDate.toISOString().slice(0, 10) !== newDateKey) continue;
      if (rangesOverlap(toMinutes(newStart), toMinutes(newEnd), toMinutes(sib.startTime), toMinutes(sib.endTime))) {
        sendError(res, `Schedule conflict on ${newDateKey}: overlaps with another subject's timing`, 400);
        return;
      }
    }

    if (roomId) {
      const room = await prisma.schoolRoom.findUnique({ where: { id: roomId }, include: { floor: { include: { building: { select: { branchId: true } } } } } });
      if (!room || room.floor.building.branchId !== entry.exam.class.branchId) {
        sendError(res, "Room not found in this branch", 404);
        return;
      }
    }

    const updated = await prisma.examSchedule.update({
      where: { id },
      data: {
        ...(examDate !== undefined && { examDate: newDate }),
        ...(startTime !== undefined && { startTime }),
        ...(endTime !== undefined && { endTime }),
        ...(durationMinutes !== undefined && { durationMinutes }),
        ...(maxMarks !== undefined && { maxMarks }),
        ...(roomId !== undefined && { roomId: roomId || null }),
      },
    });
    sendSuccess(res, updated, "Schedule entry updated");
  } catch (error) { sendError(res, "Failed to update schedule entry", 500, (error as Error).message); }
};

/**
 * Deletes a single schedule entry. Blocked once any question paper has
 * been uploaded against it, or any exam attendance/seat allocation
 * exists - all real workflow state that must not silently disappear.
 */
export const deleteExamScheduleEntry = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const entry = await prisma.examSchedule.findUnique({
      where: { id },
      include: { exam: { include: { class: { select: { branchId: true } } } } },
    });
    if (!entry) { sendError(res, "Schedule entry not found", 404); return; }
    if (!canAccessBranch(req, entry.exam.class.branchId)) { sendError(res, "Schedule entry not found", 404); return; }

    const [paperCount, seatCount, attendanceCount] = await Promise.all([
      prisma.examQuestionPaper.count({ where: { examScheduleId: id } }),
      prisma.examSeatAllocation.count({ where: { examScheduleId: id } }),
      prisma.examAttendance.count({ where: { examScheduleId: id } }),
    ]);
    if (paperCount > 0 || seatCount > 0 || attendanceCount > 0) {
      sendError(res, "Cannot delete: this schedule entry already has a question paper, seat allocation, or attendance recorded against it", 400);
      return;
    }

    await prisma.examSchedule.delete({ where: { id } });
    sendSuccess(res, null, "Schedule entry deleted");
  } catch (error) { sendError(res, "Failed to delete schedule entry", 500, (error as Error).message); }
};
