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
 * Best-effort subject name lookup for error messages only - a raw
 * cuid subjectId in an error string (e.g. "Subject cmrhhr4jz00057uc...:
 * endTime must be after startTime") tells an admin nothing about WHICH
 * row on the timetable to fix, so error paths below show the actual
 * subject name instead. Deliberately lazy (only called once an error
 * is already being built, for just the one or two subjects involved)
 * rather than bulk-fetched upfront for every request - this is a
 * display nicety, not validation-critical, so any failure here (a
 * missing subject row, a transient DB hiccup) falls back to the raw
 * id rather than ever blocking or crashing the actual request.
 */
const getSubjectLabel = async (subjectId: string): Promise<string> => {
  try {
    const subject = await prisma.subject.findUnique({ where: { id: subjectId }, select: { name: true } });
    return subject?.name || subjectId;
  } catch {
    return subjectId;
  }
};

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

    // Overlap check: group by date, then compare every pair within
    // that date's entries.
    const byDate: Record<string, { subjectId: string; start: number; end: number }[]> = {};
    for (const s of schedule) {
      const dateKey = new Date(s.examDate).toISOString().slice(0, 10);
      const start = toMinutes(s.startTime);
      const end = toMinutes(s.endTime);
      if (end <= start) {
        const label = await getSubjectLabel(s.subjectId);
        sendError(
          res,
          `${label}: End Time (${s.endTime}) must be after Start Time (${s.startTime}). If this was meant to be in the afternoon/evening, double-check the End Time's AM/PM.`,
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
            const [labelA, labelB] = await Promise.all([getSubjectLabel(entries[i].subjectId), getSubjectLabel(entries[j].subjectId)]);
            sendError(res, `Schedule conflict on ${dateKey}: ${labelA} and ${labelB} overlap in time`, 400);
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

    // BUG FIX: this previously did an unconditional deleteMany(all
    // rows for this exam) + createMany(the submitted list) on EVERY
    // save, even when nothing was actually being removed. But
    // ExamQuestionPaper/ExamSeatAllocation/ExamAttendance all have a
    // REQUIRED (non-nullable, non-cascading) foreign key to
    // ExamSchedule - the instant ANY existing row already had a
    // question paper uploaded, a seat plan generated, or attendance
    // marked against it (all real, common workflow state - see
    // deleteExamScheduleEntry's own guard against exactly this), that
    // deleteMany threw a Postgres foreign-key-constraint violation.
    // The generic catch block below caught it, and in production
    // sendError strips the real detail for any 5xx response (see
    // utils/response.ts), so admins only ever saw the unhelpful
    // "Failed to save exam schedule" with zero indication of why -
    // even for a save that only changed an unrelated field on one row.
    //
    // Fixed by upserting each submitted entry via its (examId,
    // subjectId) unique key - updates an existing row in place
    // (preserving its id, and therefore anything that references it)
    // instead of deleting and recreating it - and only deleting rows
    // for subjects that were REMOVED from the list, which is blocked
    // with a clear message (rather than a raw DB error) if that
    // specific row has dependent records.
    const submittedSubjectIds = new Set(schedule.map((s: any) => s.subjectId));
    const existingEntries = await prisma.examSchedule.findMany({
      where: { examId },
      include: {
        subject: { select: { name: true } },
        _count: { select: { questionPapers: true, seatAllocations: true, examAttendances: true } },
      },
    });
    const removedEntries = existingEntries.filter((e) => !submittedSubjectIds.has(e.subjectId));
    const blockedRemovals = removedEntries.filter(
      (e) => e._count.questionPapers > 0 || e._count.seatAllocations > 0 || e._count.examAttendances > 0
    );
    if (blockedRemovals.length > 0) {
      const names = blockedRemovals.map((e) => e.subject.name).join(", ");
      sendError(
        res,
        `Cannot remove ${names} from the schedule - a question paper, seat allocation, or attendance record already exists for it. Delete those first, or keep this subject in the schedule.`,
        400
      );
      return;
    }

    await prisma.$transaction(async (tx) => {
      if (removedEntries.length > 0) {
        await tx.examSchedule.deleteMany({ where: { id: { in: removedEntries.map((e) => e.id) } } });
      }
      for (const s of schedule) {
        await tx.examSchedule.upsert({
          where: { examId_subjectId: { examId, subjectId: s.subjectId } },
          update: {
            examDate: new Date(s.examDate),
            startTime: s.startTime,
            endTime: s.endTime,
            durationMinutes: s.durationMinutes,
            maxMarks: s.maxMarks,
            roomId: s.roomId || null,
          },
          create: {
            examId,
            subjectId: s.subjectId,
            examDate: new Date(s.examDate),
            startTime: s.startTime,
            endTime: s.endTime,
            durationMinutes: s.durationMinutes,
            maxMarks: s.maxMarks,
            roomId: s.roomId || null,
          },
        });
      }
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
 * Invigilator duty assignment (spec Section 20 - "Invigilator clash
 * auto-check required: system prevents/flags a teacher from being
 * double-assigned to exam duty"). Checks for a time-overlapping
 * assignment for the SAME staff member across every OTHER exam
 * schedule (not just this one) on the same date - the DB-level
 * @@unique([examScheduleId, staffId]) only stops a duplicate on the
 * exact same sitting, so this catches the more realistic
 * "double-booked at the same time across two different rooms" case.
 */
export const assignInvigilator = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { examScheduleId, staffId } = req.body;

    const schedule = await prisma.examSchedule.findUnique({
      where: { id: examScheduleId },
      include: { exam: { include: { class: { select: { branchId: true } } } } },
    });
    if (!schedule) { sendError(res, "Exam schedule not found", 404); return; }
    if (!canAccessBranch(req, schedule.exam.class.branchId)) { sendError(res, "Exam schedule not found", 404); return; }

    const dateKey = schedule.examDate.toISOString().slice(0, 10);
    const sameDaySchedules = await prisma.examSchedule.findMany({
      where: { examDate: schedule.examDate, id: { not: examScheduleId } },
      select: { id: true, startTime: true, endTime: true, subject: { select: { name: true } } },
    });

    const existingDuties = await prisma.examInvigilator.findMany({
      where: { staffId, examScheduleId: { in: sameDaySchedules.map((s) => s.id) } },
      include: { examSchedule: { select: { id: true, startTime: true, endTime: true, subject: { select: { name: true } } } } },
    });

    for (const duty of existingDuties) {
      if (rangesOverlap(toMinutes(schedule.startTime), toMinutes(schedule.endTime), toMinutes(duty.examSchedule.startTime), toMinutes(duty.examSchedule.endTime))) {
        sendError(res, `Clash: this teacher is already assigned as invigilator for ${duty.examSchedule.subject.name} at an overlapping time on ${dateKey}`, 400);
        return;
      }
    }

    const assignment = await prisma.examInvigilator.upsert({
      where: { examScheduleId_staffId: { examScheduleId, staffId } },
      update: {},
      create: { examScheduleId, staffId },
    });
    sendSuccess(res, assignment, "Invigilator assigned", 201);
  } catch (error) { sendError(res, "Failed to assign invigilator", 500, (error as Error).message); }
};

export const removeInvigilator = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { examScheduleId, staffId } = req.params;
    await prisma.examInvigilator.delete({ where: { examScheduleId_staffId: { examScheduleId, staffId } } });
    sendSuccess(res, null, "Invigilator removed");
  } catch (error) { sendError(res, "Failed to remove invigilator", 500, (error as Error).message); }
};

export const getInvigilators = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { examScheduleId } = req.params;
    const invigilators = await prisma.examInvigilator.findMany({
      where: { examScheduleId },
      include: { staff: { include: { user: { select: { name: true } } } } },
    });
    sendSuccess(res, invigilators, "Invigilators fetched");
  } catch (error) { sendError(res, "Failed to fetch invigilators", 500, (error as Error).message); }
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
