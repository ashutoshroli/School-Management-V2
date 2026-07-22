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
 * Roll number assignment rule (spec Section 18 - "Roll Number assigned
 * on the STUDENT'S FIRST ATTENDANCE DAY, not at admission").
 * Triggered from markStudentAttendance below for every batch of
 * students just marked - only students with rollNoAssignedAt still
 * null (i.e. today IS their first attendance) are considered;
 * everyone else is a no-op skip.
 *
 * Ordering is decided by the branch's configured RollNumberRule:
 *  - PERFORMANCE_BASED: ranked by average exam marks so far (students
 *    with no marks yet sort last within this batch), alphabetical
 *    tiebreak.
 *  - FEES_BASED: students who have cleared ALL dues rank first,
 *    alphabetical tiebreak.
 *  - ALPHABETICAL: pure alphabetical (also the universal tiebreaker
 *    for the other two rules above).
 *
 * New roll numbers continue sequentially from the section's current
 * highest already-assigned numeric roll number (reusing the same
 * "parse existing numeric rollNo values" approach as
 * generateNextRollNo in student.controller.ts, kept as a separate
 * copy here since this file has its own independent import surface
 * and the two helpers' triggering conditions differ enough - admission
 * -time vs first-attendance-time - that sharing one function would
 * conflate two different lifecycle events).
 */
const assignRollNumbersForFirstAttendance = async (sectionId: string, studentIds: string[]): Promise<void> => {
  const section = await prisma.section.findUnique({ where: { id: sectionId }, select: { branchId: true } });
  if (!section) return;
  const branch = await prisma.branch.findUnique({ where: { id: section.branchId }, select: { rollNumberRule: true } });
  const rule = branch?.rollNumberRule || "ALPHABETICAL";

  const candidates = await prisma.student.findMany({
    where: { id: { in: studentIds }, rollNoAssignedAt: null },
    include: { user: { select: { name: true } } },
  });
  if (candidates.length === 0) return;

  let ranked = candidates;
  if (rule === "PERFORMANCE_BASED") {
    const avgMarks = await Promise.all(
      candidates.map(async (s) => {
        const agg = await prisma.mark.aggregate({ where: { studentId: s.id }, _avg: { obtainedMarks: true } });
        return { student: s, avg: agg._avg.obtainedMarks ? Number(agg._avg.obtainedMarks) : -1 };
      })
    );
    ranked = avgMarks
      .sort((a, b) => b.avg - a.avg || a.student.user.name.localeCompare(b.student.user.name))
      .map((x) => x.student);
  } else if (rule === "FEES_BASED") {
    const duesCounts = await Promise.all(
      candidates.map(async (s) => {
        const pending = await prisma.feeAssignment.count({ where: { studentId: s.id, status: { in: ["PENDING", "PARTIAL", "OVERDUE"] } } });
        return { student: s, hasDues: pending > 0 };
      })
    );
    ranked = duesCounts
      .sort((a, b) => Number(a.hasDues) - Number(b.hasDues) || a.student.user.name.localeCompare(b.student.user.name))
      .map((x) => x.student);
  } else {
    ranked = [...candidates].sort((a, b) => a.user.name.localeCompare(b.user.name));
  }

  const existing = await prisma.student.findMany({ where: { sectionId }, select: { rollNo: true } });
  const numericRollNos = existing
    .map((s) => (s.rollNo && /^\d+$/.test(s.rollNo) ? parseInt(s.rollNo, 10) : null))
    .filter((n): n is number => n !== null);
  let nextNo = numericRollNos.length > 0 ? Math.max(...numericRollNos) + 1 : 1;

  await prisma.$transaction(
    ranked.map((s) =>
      prisma.student.update({ where: { id: s.id }, data: { rollNo: String(nextNo++), rollNoAssignedAt: new Date() } })
    )
  );
};

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

    // Period 1's marking auto-copies as the default to every later
    // period the same day (spec Section 6) - only when THIS save is
    // for period 1 specifically; a period-specific teacher marking
    // their own later period independently (attendancePeriod > 1)
    // never triggers this copy-forward, it just records that one
    // period directly as already-handled above.
    if (attendancePeriod === 1) {
      const periodConfigs = await prisma.periodConfig.findMany({
        where: { branchId: section.branchId, isBreak: false, periodNo: { gt: 1 } },
        select: { periodNo: true },
      });
      if (periodConfigs.length > 0) {
        const laterPeriods = periodConfigs.map((p) => p.periodNo);
        const existingLater = await prisma.studentAttendance.findMany({
          where: { studentId: { in: studentIds }, date: attendanceDate, period: { in: laterPeriods } },
          select: { studentId: true, period: true },
        });
        const existingKey = new Set(existingLater.map((r) => `${r.studentId}:${r.period}`));

        const toCopy = records.flatMap((rec: any) =>
          laterPeriods
            .filter((p) => !existingKey.has(`${rec.studentId}:${p}`))
            .map((p) => ({
              studentId: rec.studentId, sectionId, date: attendanceDate, status: rec.status,
              period: p, source: "MANUAL" as const, markedBy: req.user!.userId, copiedFromPeriod1: true,
            }))
        );
        if (toCopy.length > 0) {
          await prisma.studentAttendance.createMany({ data: toCopy });
        }
      }
    }

    // Roll number assignment on first attendance day (spec Section 18)
    // - fires for every student in this batch whose attendance hasn't
    // been recorded before today (handled inside the helper via the
    // rollNoAssignedAt null check), independent of which period was
    // marked.
    assignRollNumbersForFirstAttendance(sectionId, studentIds).catch((err) =>
      console.error("Failed to auto-assign roll numbers on first attendance:", err)
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
        // rfidTappedAt tracked independently of the Class Teacher's
        // separate manual verification (spec Section 6 - both apply
        // together, see verifyStudentAttendance above).
        await prisma.studentAttendance.update({ where: { id: existing.id }, data: { outTime: tapTime, rfidTappedAt: tapTime } });
        sendSuccess(res, { action: "OUT" }, "OUT recorded");
        notifyCardTap(student.id, "exit", tapTime);
      }
    } else {
      await prisma.studentAttendance.create({
        data: { studentId: student.id, sectionId: student.sectionId, date: today, status: "PRESENT", inTime: tapTime, source: "CARD_TAP", deviceId, rfidTappedAt: tapTime },
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
 * Class Teacher's manual verification of a student's attendance (spec
 * Section 6 - "both auto-tracking and manual verification apply
 * together"). Independent of `status`/`source` (which reflect
 * whatever RFID tap or manual mark already exists) - this only flips
 * the separate verifiedByClassTeacher/verifiedAt/verifiedBy fields,
 * confirming that a human (specifically the class teacher) has looked
 * at and endorsed the day's record, whatever it says.
 */
export const verifyStudentAttendance = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params; // StudentAttendance row id

    const record = await prisma.studentAttendance.findUnique({ where: { id }, include: { section: { select: { branchId: true, classTeacherId: true } } } });
    if (!record) { sendError(res, "Attendance record not found", 404); return; }
    if (!canAccessBranch(req, record.section.branchId)) { sendError(res, "Attendance record not found", 404); return; }

    if (req.user!.role === "TEACHER") {
      const staff = await prisma.staff.findUnique({ where: { userId: req.user!.userId }, select: { id: true } });
      if (!staff || staff.id !== record.section.classTeacherId) {
        sendError(res, "Only this class's Class Teacher may verify its attendance", 403);
        return;
      }
    }

    const updated = await prisma.studentAttendance.update({
      where: { id },
      data: { verifiedByClassTeacher: true, verifiedAt: new Date(), verifiedBy: req.user!.userId },
    });
    sendSuccess(res, updated, "Attendance verified by Class Teacher");
  } catch (error) { sendError(res, "Failed to verify attendance", 500, (error as Error).message); }
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
      where: { sectionId: sectionId as string, date: new Date(date as string), period: req.query.period ? parseInt(req.query.period as string, 10) : null },
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
 * Day-wise attendance summary for one student on one date, rolling up
 * every period-wise record (if any) into a single row: "Present in X
 * of Y periods" + the overall status for each period. Useful for a
 * parent/admin view that needs a combined picture without inspecting
 * raw records manually, especially once period-wise marking is in use.
 */
export const getDayAttendanceSummary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { studentId, date } = req.query;
    if (!studentId || !date) { sendError(res, "studentId and date required", 400); return; }

    const student = await prisma.student.findUnique({ where: { id: studentId as string }, select: { branchId: true } });
    if (!student) { sendError(res, "Student not found", 404); return; }
    if (!canAccessBranch(req, student.branchId) && !(await canAccessStudentRecord(req, studentId as string))) {
      sendError(res, "Student not found", 404);
      return;
    }

    const attendanceDate = new Date(date as string);
    const records = await prisma.studentAttendance.findMany({
      where: { studentId: studentId as string, date: attendanceDate },
      orderBy: { period: "asc" },
    });

    // Separate day-wise (period=null) from period-wise records
    const dayWise = records.find((r) => r.period === null);
    const periodWise = records.filter((r) => r.period !== null);

    const periodCount = periodWise.length;
    const presentPeriods = periodWise.filter((r) => r.status === "PRESENT" || r.status === "LATE").length;

    sendSuccess(res, {
      dayWise: dayWise || null,
      periodWise,
      summary: {
        totalPeriods: periodCount,
        presentPeriods,
        absentPeriods: periodCount - presentPeriods,
        overallStatus: dayWise?.status || (periodCount > 0 ? (presentPeriods >= periodCount / 2 ? "PRESENT" : "ABSENT") : null),
      },
    }, "Day attendance summary fetched");
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
