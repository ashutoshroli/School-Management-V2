import { Response } from "express";
import { NotificationChannel } from "@prisma/client";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { canAccessBranch } from "../utils/branchScope";
import { canAccessStudentRecord } from "../utils/studentAccess";
import { canTeacherAccessSection, getOwnAssignedSectionIds } from "../utils/teacherAccess";
import { authenticateDevice, extractDeviceApiKey } from "../utils/deviceAuth";
import { notifyParentsOfStudent } from "../services/notification.service";
import { toAttendanceDateOnly } from "../utils/attendanceDate";

/**
 * Mark student attendance (teacher marks for a class/section/date)
 *
 * BUG FIX HISTORY:
 *   1. This used to be a non-atomic "check-then-act" loop -
 *      `findUnique` then `create`-or-`update`, one record at a time,
 *      with no transaction, which could fail on a retried/double-fired
 *      request.
 *   2. That was "fixed" by switching to `upsert()` against the
 *      `[studentId, date, period]` compound unique key - but `period`
 *      is NULLABLE, and Prisma's `upsert`/`update` `where` clause
 *      (the "extendedWhereUnique" feature) has a long-standing,
 *      well-documented limitation with compound unique constraints
 *      that include a nullable column: see prisma/prisma#3197 and
 *      #16880. In practice this made `upsert()` throw on EVERY call
 *      for day-wise attendance (period: null), not just on a retry -
 *      i.e. attendance could never be saved at all, which matches the
 *      "unable to save attendance" report exactly (immediate failure,
 *      not just on re-submission).
 *
 * Fixed properly this time: avoid the nullable-field compound unique
 * `where` entirely. Look up any existing record with a plain
 * `findFirst` (which has no such limitation), then explicitly
 * `create()` or `update()` by its real `id`. Every record in the batch
 * is still wrapped in one `$transaction` so the whole save is
 * all-or-nothing.
 */
export const markStudentAttendance = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { sectionId, date, period, records } = req.body;
    // records: [{studentId, status}]

    if (!sectionId || !date) {
      sendError(res, "sectionId and date are required", 400);
      return;
    }
    if (!Array.isArray(records) || records.length === 0) {
      sendError(res, "records must be a non-empty array of {studentId, status}", 400);
      return;
    }
    for (const rec of records) {
      if (!rec.studentId || !rec.status) {
        sendError(res, "Every record must include studentId and status", 400);
        return;
      }
    }

    const section = await prisma.section.findUnique({ where: { id: sectionId }, select: { branchId: true } });
    if (!section) { sendError(res, "Section not found", 404); return; }
    if (!canAccessBranch(req, section.branchId)) {
      sendError(res, "Access denied: branch mismatch", 403);
      return;
    }
    // SECURITY: a TEACHER (unlike ADMIN roles) must actually be
    // assigned to this section - either as its class teacher or via a
    // class-specific SubjectTeacher row - to mark its attendance. See
    // teacherAccess.ts's doc comment for exactly what counts.
    if (!(await canTeacherAccessSection(req, sectionId))) {
      sendError(res, "You are not assigned to this class", 403);
      return;
    }

    const attendanceDate = new Date(date);
    const attendancePeriod = period || null;

    const studentIds = records.map((r: any) => r.studentId);
    // Plain findMany, filtering by `period` with a regular equality
    // check (works fine for null via Prisma's query engine - it's
    // specifically the unique-constraint-based `where` in
    // upsert/update that's broken for nullable compound keys, not
    // ordinary filtering).
    const existingRecords = await prisma.studentAttendance.findMany({
      where: { studentId: { in: studentIds }, date: attendanceDate, period: attendancePeriod },
      select: { id: true, studentId: true },
    });
    const existingByStudentId = new Map(existingRecords.map((r) => [r.studentId, r.id]));
    const created = records.length - existingByStudentId.size;
    const updated = existingByStudentId.size;

    await prisma.$transaction(
      records.map((rec: any) => {
        const existingId = existingByStudentId.get(rec.studentId);
        return existingId
          ? prisma.studentAttendance.update({ where: { id: existingId }, data: { status: rec.status } })
          : prisma.studentAttendance.create({
              data: {
                studentId: rec.studentId,
                sectionId,
                date: attendanceDate,
                status: rec.status,
                period: attendancePeriod,
                source: "MANUAL",
                markedBy: req.user!.userId,
              },
            });
      })
    );

    sendSuccess(res, { created, updated }, `Attendance saved: ${created} new, ${updated} updated`);
  } catch (error) { sendError(res, "Failed to save attendance", 500, (error as Error).message); }
};

/**
 * Card-tap attendance for students.
 *
 * Deliberately not behind `authenticate` (see deviceAuth.ts) - a
 * physical RFID reader authenticates via its own apiKey instead of a
 * user JWT. Also additionally scoped to the device's OWN branch: a
 * device registered for Branch A can only tap students who belong to
 * Branch A, even if it somehow presents a valid cardId belonging to a
 * student in Branch B (defense in depth beyond the apiKey check).
 */
export const studentCardTap = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { cardId, deviceId, timestamp } = req.body;

    const device = await authenticateDevice(deviceId, extractDeviceApiKey(req), res);
    if (!device) return;

    const student = await prisma.student.findUnique({ where: { cardId } });
    if (!student) { sendError(res, "Card not registered", 404); return; }
    if (student.branchId !== device.branchId) { sendError(res, "Card not registered", 404); return; }

    const tapTime = timestamp ? new Date(timestamp) : new Date();
    // BUG FIX: see toAttendanceDateOnly's doc comment - this used to be
    // `new Date(y, m, d)` (local midnight), which doesn't match the
    // UTC-midnight date manual attendance marking produces from a
    // "YYYY-MM-DD" input string. Card-tap and manually-marked
    // attendance for the same calendar day must resolve to the exact
    // same `date` value, or they'll be treated as two different days.
    const today = toAttendanceDateOnly(tapTime);

    const existing = await prisma.studentAttendance.findFirst({
      where: { studentId: student.id, date: today, period: null },
    });

    if (existing) {
      if (existing.inTime) {
        const diff = (tapTime.getTime() - new Date(existing.inTime).getTime()) / 60000;
        if (diff < 2) { sendSuccess(res, { ignored: true }, "Duplicate tap"); return; }
        await prisma.studentAttendance.update({ where: { id: existing.id }, data: { outTime: tapTime } });
        sendSuccess(res, { action: "OUT" }, "OUT recorded");
        notifyCardTap(student.id, "exit", tapTime);
      }
    } else {
      await prisma.studentAttendance.create({
        data: { studentId: student.id, sectionId: student.sectionId, date: today, status: "PRESENT", inTime: tapTime, source: "CARD_TAP", deviceId },
      });
      sendSuccess(res, { action: "IN" }, "IN recorded", 201);
      notifyCardTap(student.id, "entry", tapTime);
    }
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

const formatTapTime = (d: Date): string =>
  new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }).format(d);

/**
 * Fire-and-forget real-time parent notification on a card-tap
 * entry/exit - deliberately not awaited by the caller (studentCardTap
 * above already sent its HTTP response) so a slow/failed SMS/email
 * send never delays the reader's response or causes it to retry the
 * tap. Uses the student's own name lookup lazily since studentCardTap's
 * `student` object doesn't include `user` (kept minimal there to avoid
 * an unnecessary join on the hot device-tap path).
 */
const notifyCardTap = (studentId: string, type: "entry" | "exit", time: Date): void => {
  (async () => {
    const student = await prisma.student.findUnique({ where: { id: studentId }, include: { user: { select: { name: true } } } });
    if (!student) return;

    const timeStr = formatTapTime(time);
    const body =
      type === "entry"
        ? `${student.user.name} arrived at school at ${timeStr}. Have a great day!`
        : `${student.user.name} left school at ${timeStr}. See you tomorrow!`;

    await notifyParentsOfStudent(studentId, {
      type: type === "entry" ? "ATTENDANCE_IN" : "ATTENDANCE_OUT",
      title: type === "entry" ? "Arrived at School" : "Left School",
      body,
      channels: [NotificationChannel.SMS],
    });
  })().catch((err) => console.error("Failed to send card-tap notification:", err));
};

/**
 * A teacher's own "which classes can I act on" section list - for the
 * attendance page's section-picker, so a TEACHER is never even shown a
 * section `canTeacherAccessSection` would go on to reject. Any staff
 * role can call this (it just returns an empty list for a non-teacher
 * staff role, since `getOwnAssignedSectionIds` looks at the SAME
 * class-teacher/SubjectTeacher assignments regardless of role) -
 * ADMIN roles have their own unrestricted `/classes` listing for a
 * full picker and don't need this narrower one.
 */
export const getMyAssignedSections = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sectionIds = await getOwnAssignedSectionIds(req);
    if (sectionIds.length === 0) { sendSuccess(res, [], "Assigned sections fetched"); return; }

    const sections = await prisma.section.findMany({
      where: { id: { in: sectionIds } },
      include: { class: { select: { id: true, name: true } } },
      orderBy: [{ class: { numericOrder: "asc" } }, { name: "asc" }],
    });
    sendSuccess(res, sections, "Assigned sections fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Get attendance for a class/section on a date
 */
export const getClassAttendance = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { sectionId, date } = req.query;
    if (!sectionId || !date) { sendError(res, "sectionId and date required", 400); return; }

    // SECURITY: this endpoint previously had NO access check at all
    // beyond `authenticate`/`authorize(...TEACHERS)` at the route level
    // - any teacher/admin in ANY branch could view any section's
    // attendance by ID (IDOR), and even within one branch a teacher
    // could view a class they don't teach. Both are fixed here.
    const section = await prisma.section.findUnique({ where: { id: sectionId as string }, select: { branchId: true } });
    if (!section) { sendError(res, "Section not found", 404); return; }
    if (!canAccessBranch(req, section.branchId)) { sendError(res, "Section not found", 404); return; }
    if (!(await canTeacherAccessSection(req, sectionId as string))) {
      sendError(res, "You are not assigned to this class", 403);
      return;
    }

    const students = await prisma.student.findMany({
      where: { sectionId: sectionId as string, isActive: true },
      include: { user: { select: { name: true } } },
      orderBy: { user: { name: "asc" } },
    });

    const records = await prisma.studentAttendance.findMany({
      where: { sectionId: sectionId as string, date: new Date(date as string), period: null },
    });

    const result = students.map(s => ({
      studentId: s.id, name: s.user.name, admissionNo: s.admissionNo, rollNo: s.rollNo,
      attendance: records.find(r => r.studentId === s.id) || null,
    }));

    const summary = {
      total: students.length,
      present: records.filter(r => r.status === "PRESENT").length,
      absent: records.filter(r => r.status === "ABSENT").length,
      late: records.filter(r => r.status === "LATE").length,
    };

    sendSuccess(res, { students: result, summary }, "Class attendance fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Get student attendance history (monthly)
 */
export const getStudentAttendanceHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { studentId } = req.params;

    // SECURITY: this endpoint previously had no access control at all
    // beyond `authenticate` - any authenticated user could view any
    // student's attendance history by ID (IDOR). Restrict to branch
    // staff or the student/parent themselves.
    const student = await prisma.student.findUnique({ where: { id: studentId }, select: { branchId: true } });
    if (!student) { sendError(res, "Student not found", 404); return; }
    if (!canAccessBranch(req, student.branchId) && !(await canAccessStudentRecord(req, studentId))) {
      sendError(res, "Student not found", 404);
      return;
    }

    const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year as string) || new Date().getFullYear();

    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59);

    const records = await prisma.studentAttendance.findMany({
      where: { studentId, date: { gte: start, lte: end }, period: null },
      orderBy: { date: "asc" },
    });

    const summary = {
      present: records.filter(r => r.status === "PRESENT").length,
      absent: records.filter(r => r.status === "ABSENT").length,
      late: records.filter(r => r.status === "LATE").length,
      halfDay: records.filter(r => r.status === "HALF_DAY").length,
      total: records.length,
      percentage: records.length > 0 ? Math.round((records.filter(r => r.status === "PRESENT" || r.status === "LATE").length / records.length) * 100) : 0,
    };

    sendSuccess(res, { records, summary, month, year }, "History fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};
