import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { resolveBranchId, canAccessBranch } from "../utils/branchScope";
import { authenticateDevice, extractDeviceApiKey } from "../utils/deviceAuth";
import { toAttendanceDateOnly } from "../utils/attendanceDate";

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
    const existed = !!(await prisma.staffAttendance.findUnique({
      where: { staffId_date: { staffId, date: attendanceDate } },
      select: { id: true },
    }));

    const attendance = await prisma.staffAttendance.upsert({
      where: { staffId_date: { staffId, date: attendanceDate } },
      update: { status, inTime: inTime ? new Date(inTime) : undefined, outTime: outTime ? new Date(outTime) : undefined, remarks },
      create: { staffId, date: attendanceDate, status, inTime: inTime ? new Date(inTime) : null, outTime: outTime ? new Date(outTime) : null, source: "MANUAL", remarks },
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
      select: { staffId: true },
    });
    const existingIds = new Set(existingRecords.map((r) => r.staffId));
    const created = records.filter((r: any) => !existingIds.has(r.staffId)).length;
    const updated = records.length - created;

    await prisma.$transaction(
      records.map((rec: any) =>
        prisma.staffAttendance.upsert({
          where: { staffId_date: { staffId: rec.staffId, date: attendanceDate } },
          update: { status: rec.status, remarks: rec.remarks },
          create: { staffId: rec.staffId, date: attendanceDate, status: rec.status, source: "MANUAL", remarks: rec.remarks },
        })
      )
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
        // Set OUT time
        await prisma.staffAttendance.update({
          where: { id: existing.id },
          data: { outTime: tapTime },
        });
        sendSuccess(res, { action: "OUT", time: tapTime }, "OUT time recorded");
      }
    } else {
      // First tap = IN
      await prisma.staffAttendance.create({
        data: {
          staffId: staff.id, date: today, status: "PRESENT",
          inTime: tapTime, source: "CARD_TAP", deviceId,
        },
      });
      sendSuccess(res, { action: "IN", time: tapTime }, "IN time recorded", 201);
    }
  } catch (error) {
    sendError(res, "Card tap failed", 500, (error as Error).message);
  }
};

/**
 * Get staff attendance calendar (monthly)
 */
export const getAttendanceCalendar = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { staffId } = req.params;
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
