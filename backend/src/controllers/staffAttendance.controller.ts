import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { resolveBranchId, canAccessBranch } from "../utils/branchScope";
import { canAccessStaffRecord } from "../utils/staffAccess";
import { authenticateDevice, extractDeviceApiKey } from "../utils/deviceAuth";
import { toAttendanceDateOnly } from "../utils/attendanceDate";
import { buildCsv, sendCsv, CsvColumn } from "../services/csvExport.service";

/**
 * A "day start" cutoff used to auto-flag LATE instead of PRESENT when
 * a staff member's inTime is after this - without this, an admin had
 * to remember to manually pick LATE every time instead of the system
 * just knowing. Kept as a simple constant (not yet a
 * per-branch-configurable setting) since there's no existing
 * "branch settings" key-value store to hang it off of - PeriodConfig's
 * first period start time would be a reasonable proxy for a future
 * enhancement, but that couples two independent concepts (period
 * schedule vs. staff late-cutoff) for a same-phase implementation.
 */
const LATE_CUTOFF_HOUR = 9;
const LATE_CUTOFF_MINUTE = 15;

const isLateArrival = (inTime: Date): boolean => {
  return inTime.getHours() > LATE_CUTOFF_HOUR || (inTime.getHours() === LATE_CUTOFF_HOUR && inTime.getMinutes() > LATE_CUTOFF_MINUTE);
};

/**
 * Symmetric "shift end" cutoff for flagging an early departure -
 * same simple-constant rationale as LATE_CUTOFF_HOUR/MINUTE above
 * (not yet a per-branch-configurable setting).
 */
const EARLY_EXIT_CUTOFF_HOUR = 16;
const EARLY_EXIT_CUTOFF_MINUTE = 30;

const isEarlyDeparture = (outTime: Date): boolean => {
  return outTime.getHours() < EARLY_EXIT_CUTOFF_HOUR || (outTime.getHours() === EARLY_EXIT_CUTOFF_HOUR && outTime.getMinutes() < EARLY_EXIT_CUTOFF_MINUTE);
};

/**
 * Late-entry / early-exit combined penalty (spec Section 6, see
 * StaffAttendance.isLateEntry/isEarlyExit/periodsDeducted's doc
 * comment in schema.prisma) - every Branch.lateEarlyPenaltyThreshold
 * COMBINED late-entry+early-exit occurrences within a rolling window
 * of Branch.attendanceWeekCycleDays deducts Branch.
 * lateEarlyPenaltyPeriods period(s) from the occurrence that COMPLETES
 * the threshold (not spread across all of them). Uses the same
 * rolling-trailing-window convention already established by diesel.
 * controller.ts's countRequestsThisWeekCycle, rather than a fixed
 * calendar-week bucket.
 *
 * Only ever called once the caller has already determined THIS record
 * is a NEW occurrence (i.e. wasn't already counted as one before this
 * call) - callers are responsible for that "is this new?" check so
 * editing/re-saving an already-counted day never double-counts it.
 *
 * SCOPE: assumes a staff member's attendance is marked in
 * chronological order (the normal case - a given day's attendance is
 * marked that day or shortly after). Backfilling/correcting a PAST
 * date out of order after LATER dates already have periodsDeducted
 * computed will NOT retroactively recalculate those later records -
 * deliberately out of scope for this phase (would require re-walking
 * every later date's window on every historical edit).
 */
const applyLateEarlyPenalty = async (staffId: string, branchId: string, attendanceDate: Date): Promise<number> => {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { attendanceWeekCycleDays: true, lateEarlyPenaltyThreshold: true, lateEarlyPenaltyPeriods: true },
  });
  const cycleDays = branch?.attendanceWeekCycleDays || 7;
  const threshold = Math.max(branch?.lateEarlyPenaltyThreshold || 5, 1);
  const penaltyPeriods = branch?.lateEarlyPenaltyPeriods || 1;

  const windowStart = new Date(attendanceDate);
  windowStart.setDate(windowStart.getDate() - cycleDays + 1);

  // Prior occurrences strictly BEFORE attendanceDate, within the
  // window - attendanceDate's own row is excluded here (whether or
  // not it exists yet) since this record's occurrence is added
  // separately as the "+1" below, so it's never double-counted.
  const priorOccurrences = await prisma.staffAttendance.count({
    where: {
      staffId,
      date: { gte: windowStart, lt: attendanceDate },
      OR: [{ isLateEntry: true }, { isEarlyExit: true }],
    },
  });
  const cumulativeCount = priorOccurrences + 1;

  return cumulativeCount % threshold === 0 ? penaltyPeriods : 0;
};

interface LateEarlyFields {
  isLateEntry: boolean;
  isEarlyExit: boolean;
  periodsDeducted: number;
}

/**
 * Resolves the isLateEntry/isEarlyExit/periodsDeducted fields for a
 * single StaffAttendance row being created or updated.
 *
 * `newIsLateEntry`/`newIsEarlyExit` should be `undefined` when THIS
 * call doesn't have new information about that dimension (e.g. a
 * card-tap OUT event only knows about early-exit, not late-entry) -
 * `undefined` means "leave it exactly as the existing record already
 * had it" (default `false` for a brand-new record), so a call that
 * only updates one dimension never clobbers the other.
 *
 * periodsDeducted is only ever (re)computed via applyLateEarlyPenalty
 * when this record transitions from "not flagged" to "flagged" (a
 * genuinely NEW occurrence) - re-saving an already-flagged record
 * (e.g. correcting the remarks) never double-counts it. If a record
 * transitions from "flagged" to "not flagged" (an admin correcting a
 * mistaken late/early mark), this record's own deduction is reset to
 * 0 - see applyLateEarlyPenalty's doc comment for why later records'
 * already-computed deductions are NOT retroactively recalculated.
 */
const resolveLateEarlyFields = async (
  staffId: string,
  branchId: string,
  attendanceDate: Date,
  existing: LateEarlyFields | null,
  newIsLateEntry: boolean | undefined,
  newIsEarlyExit: boolean | undefined
): Promise<LateEarlyFields> => {
  const isLateEntry = newIsLateEntry !== undefined ? newIsLateEntry : existing?.isLateEntry ?? false;
  const isEarlyExit = newIsEarlyExit !== undefined ? newIsEarlyExit : existing?.isEarlyExit ?? false;

  const wasFlagged = existing ? existing.isLateEntry || existing.isEarlyExit : false;
  const isFlagged = isLateEntry || isEarlyExit;

  let periodsDeducted = existing?.periodsDeducted ?? 0;
  if (!wasFlagged && isFlagged) {
    periodsDeducted = await applyLateEarlyPenalty(staffId, branchId, attendanceDate);
  } else if (wasFlagged && !isFlagged) {
    periodsDeducted = 0;
  }

  return { isLateEntry, isEarlyExit, periodsDeducted };
};

/**
 * Mark staff attendance (manual - admin/HR marks) for a single staff
 * member.
 *
 * BUG FIX: switched the old find-then-create/update to a single atomic
 * `upsert` - see bulkMarkAttendance's doc comment below for why (the
 * same race-condition class applies here too, just for one record
 * instead of a batch).
 */
export const markAttendance = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { staffId, date, status, inTime, outTime, remarks } = req.body;

    if (!staffId || !date || !status) {
      sendError(res, "staffId, date, and status are required", 400);
      return;
    }

    const staff = await prisma.staff.findUnique({ where: { id: staffId }, select: { branchId: true } });
    if (!staff) { sendError(res, "Staff not found", 404); return; }
    if (!canAccessBranch(req, staff.branchId)) {
      sendError(res, "Access denied: branch mismatch", 403);
      return;
    }

    const attendanceDate = new Date(date);
    const existingRecord = await prisma.staffAttendance.findUnique({
      where: { staffId_date: { staffId, date: attendanceDate } },
    });
    const existed = !!existingRecord;

    // Auto-upgrade a manually-picked PRESENT to LATE based on inTime,
    // rather than requiring the admin to remember to pick LATE
    // themselves - an explicit non-PRESENT status (ABSENT/HALF_DAY/
    // ON_LEAVE) is always respected as-is, this only ever narrows
    // PRESENT specifically.
    const parsedInTime = inTime ? new Date(inTime) : null;
    const parsedOutTime = outTime ? new Date(outTime) : null;
    const finalStatus = status === "PRESENT" && parsedInTime && isLateArrival(parsedInTime) ? "LATE" : status;

    // Late-entry / early-exit combined penalty rule (spec Section 6) -
    // only re-evaluated for the dimension(s) this call actually
    // provides new inTime/outTime for; the other dimension (and the
    // resulting periodsDeducted) is preserved/recomputed via
    // resolveLateEarlyFields, see its doc comment above.
    const { isLateEntry, isEarlyExit, periodsDeducted } = await resolveLateEarlyFields(
      staffId,
      staff.branchId,
      attendanceDate,
      existingRecord,
      parsedInTime ? isLateArrival(parsedInTime) : undefined,
      parsedOutTime ? isEarlyDeparture(parsedOutTime) : undefined
    );

    const attendance = await prisma.staffAttendance.upsert({
      where: { staffId_date: { staffId, date: attendanceDate } },
      update: {
        status: finalStatus, inTime: parsedInTime || undefined, outTime: parsedOutTime || undefined, remarks,
        isLateEntry, isEarlyExit, periodsDeducted,
      },
      create: {
        staffId, date: attendanceDate, status: finalStatus, inTime: parsedInTime, outTime: parsedOutTime, source: "MANUAL", remarks,
        isLateEntry, isEarlyExit, periodsDeducted,
      },
    });

    sendSuccess(res, attendance, existed ? "Attendance updated" : "Attendance marked", existed ? 200 : 201);
  } catch (error) {
    sendError(res, "Failed to mark attendance", 500, (error as Error).message);
  }
};

/**
 * Bulk mark attendance (mark for multiple staff at once)
 *
 * BUG FIX: this used to be a non-atomic "check-then-act" loop -
 * `findUnique` then `create`-or-`update`, one record at a time, with
 * no transaction. If the same "Save All" request was double-fired
 * (slow network -> user clicks again, or an axios retry), the second
 * request's `create()` for a record the first request had just
 * inserted would violate the `[staffId, date]` unique constraint and
 * throw - the WHOLE request failed with a generic 500 "Failed to mark
 * bulk attendance", even though most/all records had already been
 * saved by the first request. This is the most likely cause of
 * "unable to save attendance" reports on this page: it looks like
 * total failure, but the data was actually already saved.
 *
 * Fixed by using `upsert` (atomic create-or-update, never throws on a
 * duplicate) for every record inside a single `$transaction`, so the
 * whole batch either fully succeeds or fully rolls back together -
 * no more silent partial saves reported as failures.
 */
export const bulkMarkAttendance = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { date, records } = req.body;
    // records: [{staffId, status, inTime?, outTime?, remarks?}]

    if (!date) {
      sendError(res, "date is required", 400);
      return;
    }
    if (!Array.isArray(records) || records.length === 0) {
      sendError(res, "records must be a non-empty array of {staffId, status}", 400);
      return;
    }
    for (const rec of records) {
      if (!rec.staffId || !rec.status) {
        sendError(res, "Every record must include staffId and status", 400);
        return;
      }
    }

    // Branch-scope every staffId in the batch up front (one query)
    // rather than trusting the client - a Branch Admin submitting a
    // batch could otherwise smuggle in a staffId from another branch.
    const staffIds: string[] = records.map((r: any) => r.staffId);
    const staffRows = await prisma.staff.findMany({
      where: { id: { in: staffIds } },
      select: { id: true, branchId: true },
    });
    const foundIds = new Set(staffRows.map((s) => s.id));
    const missing = staffIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      sendError(res, `${missing.length} staff record(s) in this batch were not found`, 404);
      return;
    }
    const outOfBranch = staffRows.some((s) => !canAccessBranch(req, s.branchId));
    if (outOfBranch) {
      sendError(res, "Access denied: branch mismatch", 403);
      return;
    }

    const attendanceDate = new Date(date);
    const existingRecords = await prisma.staffAttendance.findMany({
      where: { staffId: { in: staffIds }, date: attendanceDate },
    });
    const existingByStaffId = new Map(existingRecords.map((r) => [r.staffId, r]));
    const existingIds = new Set(existingRecords.map((r) => r.staffId));
    const created = records.filter((r: any) => !existingIds.has(r.staffId)).length;
    const updated = records.length - created;

    // Late-entry penalty rule (spec Section 6) - bulk marking is the
    // primary admin workflow (status button click, no inTime/outTime
    // collected at all), so a status of exactly "LATE" here is treated
    // as a definitive late-entry signal, same as markAttendance's
    // inTime-based detection. isEarlyExit is preserved as-is (bulk
    // marking has no outTime info to determine it from either way).
    const staffByBranchId = new Map(staffRows.map((s) => [s.id, s.branchId]));
    const lateEarlyFieldsByStaffId = new Map<string, LateEarlyFields>();
    for (const rec of records) {
      const fields = await resolveLateEarlyFields(
        rec.staffId,
        staffByBranchId.get(rec.staffId)!,
        attendanceDate,
        existingByStaffId.get(rec.staffId) || null,
        rec.status === "LATE",
        undefined
      );
      lateEarlyFieldsByStaffId.set(rec.staffId, fields);
    }

    await prisma.$transaction(
      records.map((rec: any) => {
        const { isLateEntry, isEarlyExit, periodsDeducted } = lateEarlyFieldsByStaffId.get(rec.staffId)!;
        return prisma.staffAttendance.upsert({
          where: { staffId_date: { staffId: rec.staffId, date: attendanceDate } },
          update: { status: rec.status, remarks: rec.remarks, isLateEntry, isEarlyExit, periodsDeducted },
          create: {
            staffId: rec.staffId, date: attendanceDate, status: rec.status, source: "MANUAL", remarks: rec.remarks,
            isLateEntry, isEarlyExit, periodsDeducted,
          },
        });
      })
    );

    sendSuccess(res, { created, updated }, `Attendance saved: ${created} new, ${updated} updated`);
  } catch (error) {
    sendError(res, "Failed to mark bulk attendance", 500, (error as Error).message);
  }
};

/**
 * Card-tap attendance endpoint (generic device integration).
 *
 * Deliberately not behind `authenticate` (see deviceAuth.ts) - a
 * physical RFID reader authenticates via its own apiKey, not a user
 * JWT. Also scoped to the device's own branch as defense in depth
 * beyond the apiKey check itself.
 */
export const cardTapAttendance = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { cardId, deviceId, timestamp } = req.body;

    const device = await authenticateDevice(deviceId, extractDeviceApiKey(req), res);
    if (!device) return;

    // Find staff by cardId
    const staff = await prisma.staff.findUnique({ where: { cardId } });
    if (!staff) { sendError(res, "Card not registered to any staff", 404); return; }
    if (staff.branchId !== device.branchId) { sendError(res, "Card not registered to any staff", 404); return; }

    const tapTime = timestamp ? new Date(timestamp) : new Date();
    // BUG FIX: see toAttendanceDateOnly's doc comment in
    // utils/attendanceDate.ts - this used to be `new Date(y, m, d)`
    // (local midnight), which doesn't match the UTC-midnight date
    // manual attendance marking produces from a "YYYY-MM-DD" input
    // string. Card-tap and manually-marked attendance for the same
    // calendar day must resolve to the exact same `date` value.
    const today = toAttendanceDateOnly(tapTime);

    // Check for duplicate tap (within 2 minutes)
    const existing = await prisma.staffAttendance.findUnique({
      where: { staffId_date: { staffId: staff.id, date: today } },
    });

    if (existing) {
      // If already has inTime, check if tap is within 2 min (ignore) or set outTime
      if (existing.inTime) {
        const diff = (tapTime.getTime() - new Date(existing.inTime).getTime()) / 1000 / 60;
        if (diff < 2) { sendSuccess(res, { ignored: true }, "Duplicate tap ignored (< 2 min)"); return; }
        // Set OUT time - early-exit penalty rule (spec Section 6),
        // same as markAttendance's outTime path.
        const { isLateEntry, isEarlyExit, periodsDeducted } = await resolveLateEarlyFields(
          staff.id, staff.branchId, today, existing, undefined, isEarlyDeparture(tapTime)
        );
        await prisma.staffAttendance.update({
          where: { id: existing.id },
          data: { outTime: tapTime, isLateEntry, isEarlyExit, periodsDeducted },
        });
        sendSuccess(res, { action: "OUT", time: tapTime }, "OUT time recorded");
      }
    } else {
      // First tap = IN - auto-flagged LATE instead of PRESENT if past
      // the day-start cutoff, same rule markAttendance applies for a
      // manually-entered inTime. Late-entry penalty rule (spec
      // Section 6) evaluated the same way.
      const { isLateEntry, isEarlyExit, periodsDeducted } = await resolveLateEarlyFields(
        staff.id, staff.branchId, today, null, isLateArrival(tapTime), undefined
      );
      await prisma.staffAttendance.create({
        data: {
          staffId: staff.id, date: today, status: isLateArrival(tapTime) ? "LATE" : "PRESENT",
          inTime: tapTime, source: "CARD_TAP", deviceId,
          isLateEntry, isEarlyExit, periodsDeducted,
        },
      });
      sendSuccess(res, { action: "IN", time: tapTime }, "IN time recorded", 201);
    }
  } catch (error) {
    sendError(res, "Card tap failed", 500, (error as Error).message);
  }
};

/**
 * Self check-in/out: a logged-in staff member punches their OWN
 * attendance, restricted to their own `staffId` (resolved from the
 * session, never trusting a client-supplied one) and always TODAY's
 * date - previously the only way to mark attendance at all was an
 * admin manually entering it for someone else via `markAttendance`.
 *
 * A first call with no existing record for today creates an IN punch;
 * a second call on the same day (no outTime yet) records the OUT
 * punch instead - so the same "Check In / Check Out" button just
 * works without the staff member needing to know which state they're in.
 */
export const selfMarkAttendance = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) { sendError(res, "Not authenticated", 401); return; }

    const staff = await prisma.staff.findUnique({ where: { userId }, select: { id: true, branchId: true } });
    if (!staff) { sendError(res, "No staff record linked to this account", 404); return; }

    const now = new Date();
    const today = toAttendanceDateOnly(now);

    const existing = await prisma.staffAttendance.findUnique({ where: { staffId_date: { staffId: staff.id, date: today } } });

    if (!existing) {
      // Late-entry penalty rule (spec Section 6) - same as
      // cardTapAttendance's IN path.
      const { isLateEntry, isEarlyExit, periodsDeducted } = await resolveLateEarlyFields(
        staff.id, staff.branchId, today, null, isLateArrival(now), undefined
      );
      const created = await prisma.staffAttendance.create({
        data: {
          staffId: staff.id, date: today, status: isLateArrival(now) ? "LATE" : "PRESENT", inTime: now, source: "MANUAL",
          isLateEntry, isEarlyExit, periodsDeducted,
        },
      });
      sendSuccess(res, { action: "IN", attendance: created }, "Checked in", 201);
      return;
    }

    if (!existing.outTime) {
      // Early-exit penalty rule (spec Section 6) - same as
      // cardTapAttendance's OUT path.
      const { isLateEntry, isEarlyExit, periodsDeducted } = await resolveLateEarlyFields(
        staff.id, staff.branchId, today, existing, undefined, isEarlyDeparture(now)
      );
      const updated = await prisma.staffAttendance.update({
        where: { id: existing.id },
        data: { outTime: now, isLateEntry, isEarlyExit, periodsDeducted },
      });
      sendSuccess(res, { action: "OUT", attendance: updated }, "Checked out");
      return;
    }

    sendError(res, "You have already checked in and out for today", 400);
  } catch (error) {
    sendError(res, "Failed to self-mark attendance", 500, (error as Error).message);
  }
};

/**
 * Get staff attendance calendar (monthly)
 *
 * SECURITY: previously had no access check at all beyond `authenticate`
 * - any logged-in user (e.g. a Teacher) could pull ANY other staff
 * member's attendance calendar just by supplying their staffId,
 * including staff in a completely different branch (IDOR).
 */
export const getAttendanceCalendar = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { staffId } = req.params;
    if (!(await canAccessStaffRecord(req, staffId))) {
      sendError(res, "Staff not found", 404);
      return;
    }
    const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year as string) || new Date().getFullYear();

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    const records = await prisma.staffAttendance.findMany({
      where: { staffId, date: { gte: startDate, lte: endDate } },
      orderBy: { date: "asc" },
    });

    const summary = {
      present: records.filter(r => r.status === "PRESENT").length,
      absent: records.filter(r => r.status === "ABSENT").length,
      halfDay: records.filter(r => r.status === "HALF_DAY").length,
      late: records.filter(r => r.status === "LATE").length,
      onLeave: records.filter(r => r.status === "ON_LEAVE").length,
      totalDays: records.length,
      // Late-entry/early-exit combined penalty rule (spec Section 6) -
      // lateEntryCount/earlyExitCount are raw occurrence counts (each
      // day can be counted in both if it was both late AND early that
      // day); totalPeriodsDeducted sums each day's own periodsDeducted
      // (only non-zero on the day that completed a threshold multiple).
      lateEntryCount: records.filter(r => r.isLateEntry).length,
      earlyExitCount: records.filter(r => r.isEarlyExit).length,
      totalPeriodsDeducted: records.reduce((sum, r) => sum + r.periodsDeducted, 0),
    };

    sendSuccess(res, { records, summary, month, year }, "Attendance calendar fetched");
  } catch (error) {
    sendError(res, "Failed to fetch calendar", 500, (error as Error).message);
  }
};

/**
 * Get all staff attendance for a date (for bulk marking)
 */
export const getDateAttendance = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const date = req.query.date as string;
    const branchId = resolveBranchId(req);

    if (!date || !branchId) { sendError(res, "Date and branchId required", 400); return; }

    const staffList = await prisma.staff.findMany({
      where: { branchId, isActive: true },
      include: { user: { select: { name: true } } },
      orderBy: { user: { name: "asc" } },
    });

    const existing = await prisma.staffAttendance.findMany({
      where: { staffId: { in: staffList.map(s => s.id) }, date: new Date(date) },
    });

    const result = staffList.map(staff => ({
      staffId: staff.id,
      employeeId: staff.employeeId,
      name: staff.user.name,
      designation: staff.designation,
      attendance: existing.find(a => a.staffId === staff.id) || null,
    }));

    sendSuccess(res, result, "Date attendance fetched");
  } catch (error) {
    sendError(res, "Failed to fetch", 500, (error as Error).message);
  }
};

interface StaffAttendanceReportRow {
  employeeId: string;
  name: string;
  designation: string;
  department: string;
  present: number;
  absent: number;
  halfDay: number;
  late: number;
  onLeave: number;
  workingDays: number;
  attendancePercent: number;
  // Late-entry/early-exit combined penalty rule (spec Section 6) -
  // periodsDeducted total for the month, so an admin can see who's
  // actually being penalized without cross-referencing the daily
  // calendar. Deliberately NOT yet factored into attendancePercent
  // itself - Phase 6 (Payroll) is where the attendance-for-salary
  // calculation switches to account for this.
  totalPeriodsDeducted: number;
}

/**
 * Branch-wide monthly attendance report - one row per active staff
 * member with the month's present/absent/late/leave totals and an
 * attendance percentage, excluding declared Holidays from the
 * "working days" denominator so a school-wide closure doesn't
 * artificially tank everyone's percentage. Shared by the JSON endpoint
 * and the CSV export below so both always compute identically.
 */
const buildStaffAttendanceReport = async (branchId: string, month: number, year: number): Promise<StaffAttendanceReportRow[]> => {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0, 23, 59, 59);

  const [staffList, holidays] = await Promise.all([
    prisma.staff.findMany({
      where: { branchId, isActive: true },
      include: { user: { select: { name: true } }, attendances: { where: { date: { gte: startDate, lte: endDate } } } },
      orderBy: { user: { name: "asc" } },
    }),
    prisma.holiday.count({ where: { branchId, date: { gte: startDate, lte: endDate } } }),
  ]);

  // Working days = calendar days in the month minus declared holidays.
  // Deliberately does NOT also subtract weekends - this codebase has
  // no per-branch "which days are off" concept (see DayOfWeek's
  // MONDAY-SATURDAY-only enum on TimetableSlot, implying Sunday is
  // already assumed off school-wide, but that's a timetable concept,
  // not wired into attendance reporting) - a future enhancement could
  // add a branch-level "working days" setting for a fully accurate
  // denominator.
  const daysInMonth = endDate.getDate();
  const workingDays = Math.max(daysInMonth - holidays, 1);

  return staffList.map((staff) => {
    const present = staff.attendances.filter((a) => a.status === "PRESENT").length;
    const absent = staff.attendances.filter((a) => a.status === "ABSENT").length;
    const halfDay = staff.attendances.filter((a) => a.status === "HALF_DAY").length;
    const late = staff.attendances.filter((a) => a.status === "LATE").length;
    const onLeave = staff.attendances.filter((a) => a.status === "ON_LEAVE").length;
    const effectivePresentDays = present + late + halfDay * 0.5;
    const totalPeriodsDeducted = staff.attendances.reduce((sum, a) => sum + a.periodsDeducted, 0);

    return {
      employeeId: staff.employeeId,
      name: staff.user.name,
      designation: staff.designation,
      department: staff.department,
      present, absent, halfDay, late, onLeave,
      workingDays,
      attendancePercent: workingDays > 0 ? Math.round((effectivePresentDays / workingDays) * 1000) / 10 : 0,
      totalPeriodsDeducted,
    };
  });
};

const STAFF_ATTENDANCE_REPORT_CSV_COLUMNS: CsvColumn<StaffAttendanceReportRow>[] = [
  { header: "Employee ID", accessor: (r) => r.employeeId },
  { header: "Name", accessor: (r) => r.name },
  { header: "Designation", accessor: (r) => r.designation },
  { header: "Department", accessor: (r) => r.department },
  { header: "Present", accessor: (r) => r.present },
  { header: "Absent", accessor: (r) => r.absent },
  { header: "Half Day", accessor: (r) => r.halfDay },
  { header: "Late", accessor: (r) => r.late },
  { header: "On Leave", accessor: (r) => r.onLeave },
  { header: "Working Days", accessor: (r) => r.workingDays },
  { header: "Attendance %", accessor: (r) => r.attendancePercent },
  { header: "Periods Deducted", accessor: (r) => r.totalPeriodsDeducted },
];

export const getStaffAttendanceReport = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    if (!branchId) { sendError(res, "Branch ID required", 400); return; }
    const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year as string) || new Date().getFullYear();

    const rows = await buildStaffAttendanceReport(branchId, month, year);
    sendSuccess(res, { rows, month, year }, "Staff attendance report fetched");
  } catch (error) { sendError(res, "Failed to fetch report", 500, (error as Error).message); }
};

export const exportStaffAttendanceReportCsv = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    if (!branchId) { sendError(res, "Branch ID required", 400); return; }
    const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year as string) || new Date().getFullYear();

    const rows = await buildStaffAttendanceReport(branchId, month, year);
    const csv = buildCsv(rows, STAFF_ATTENDANCE_REPORT_CSV_COLUMNS);
    sendCsv(res, `staff-attendance-${year}-${String(month).padStart(2, "0")}.csv`, csv);
  } catch (error) { sendError(res, "Failed to export report", 500, (error as Error).message); }
};
