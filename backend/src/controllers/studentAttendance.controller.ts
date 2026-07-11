import { Response } from "express";
import { NotificationChannel } from "@prisma/client";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { canAccessBranch } from "../utils/branchScope";
import { canAccessStudentRecord } from "../utils/studentAccess";
import { authenticateDevice, extractDeviceApiKey } from "../utils/deviceAuth";
import { notifyParentsOfStudent } from "../services/notification.service";
import { toAttendanceDateOnly } from "../utils/attendanceDate";

/**
 * Mark student attendance (teacher marks for a class/section/date)
 *
 * BUG FIX: this used to be a non-atomic "check-then-act" loop -
 * `findUnique` then `create`-or-`update`, one record at a time, with
 * no transaction. Two real problems fell out of that:
 *   1. Race condition: if the same "Save All" request was double-fired
 *      (slow network -> user clicks again, or a retry), the second
 *      request's `create()` for a record the first request had just
 *      inserted would violate the `[studentId, date, period]` unique
 *      constraint and throw - the whole request failed with a generic
 *      500 "Failed", even though most/all of the records had actually
 *      already been saved by the first request. This is the most
 *      likely cause of "unable to save attendance" reports: it looks
 *      like total failure, but is actually "already saved, don't panic".
 *   2. Partial failure with no rollback: if record #15 of 40 threw for
 *      ANY reason (bad status enum value, etc), records #1-14 were
 *      already committed to the database but the response still came
 *      back as a 500 error - the class teacher has no way to tell
 *      which students got saved and which didn't from that response.
 *
 * Fixed by using `upsert` (atomic per-record: create-or-update in one
 * DB round trip, never throws on a duplicate) for every record inside
 * a single `$transaction`, so the whole batch either fully succeeds or
 * fully rolls back - no more "half saved, reported as failed".
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

    const attendanceDate = new Date(date);
    const attendancePeriod = period || null;

    // Determine created-vs-updated counts up front (a single query)
    // purely for the response message - the actual writes below use
    // upsert regardless, so this split has no effect on correctness.
    const studentIds = records.map((r: any) => r.studentId);
    const existingRecords = await prisma.studentAttendance.findMany({
      where: { studentId: { in: studentIds }, date: attendanceDate, period: attendancePeriod },
      select: { studentId: true },
    });
    const existingIds = new Set(existingRecords.map((r) => r.studentId));
    const created = records.filter((r: any) => !existingIds.has(r.studentId)).length;
    const updated = records.length - created;

    await prisma.$transaction(
      records.map((rec: any) =>
        prisma.studentAttendance.upsert({
          where: { studentId_date_period: { studentId: rec.studentId, date: attendanceDate, period: attendancePeriod } },
          update: { status: rec.status },
          create: {
            studentId: rec.studentId,
            sectionId,
            date: attendanceDate,
            status: rec.status,
            period: attendancePeriod,
            source: "MANUAL",
            markedBy: req.user!.userId,
          },
        })
      )
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
 * Get attendance for a class/section on a date
 */
export const getClassAttendance = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { sectionId, date } = req.query;
    if (!sectionId || !date) { sendError(res, "sectionId and date required", 400); return; }

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
