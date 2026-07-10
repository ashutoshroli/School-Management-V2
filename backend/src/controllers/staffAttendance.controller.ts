import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { resolveBranchId, canAccessBranch } from "../utils/branchScope";

/**
 * Mark staff attendance (manual - admin/HR marks)
 */
export const markAttendance = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { staffId, date, status, inTime, outTime, remarks } = req.body;

    const existing = await prisma.staffAttendance.findUnique({
      where: { staffId_date: { staffId, date: new Date(date) } },
    });

    if (existing) {
      // Update existing
      const updated = await prisma.staffAttendance.update({
        where: { id: existing.id },
        data: { status, inTime: inTime ? new Date(inTime) : undefined, outTime: outTime ? new Date(outTime) : undefined, remarks },
      });
      sendSuccess(res, updated, "Attendance updated");
    } else {
      const attendance = await prisma.staffAttendance.create({
        data: { staffId, date: new Date(date), status, inTime: inTime ? new Date(inTime) : null, outTime: outTime ? new Date(outTime) : null, source: "MANUAL", remarks },
      });
      sendSuccess(res, attendance, "Attendance marked", 201);
    }
  } catch (error) {
    sendError(res, "Failed to mark attendance", 500, (error as Error).message);
  }
};

/**
 * Bulk mark attendance (mark for multiple staff at once)
 */
export const bulkMarkAttendance = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { date, records } = req.body;
    // records: [{staffId, status, inTime?, outTime?, remarks?}]

    let created = 0, updated = 0;
    for (const rec of records) {
      const existing = await prisma.staffAttendance.findUnique({
        where: { staffId_date: { staffId: rec.staffId, date: new Date(date) } },
      });
      if (existing) {
        await prisma.staffAttendance.update({ where: { id: existing.id }, data: { status: rec.status, remarks: rec.remarks } });
        updated++;
      } else {
        await prisma.staffAttendance.create({ data: { staffId: rec.staffId, date: new Date(date), status: rec.status, source: "MANUAL" } });
        created++;
      }
    }
    sendSuccess(res, { created, updated }, `Attendance saved: ${created} new, ${updated} updated`);
  } catch (error) {
    sendError(res, "Failed to mark bulk attendance", 500, (error as Error).message);
  }
};

/**
 * Card-tap attendance endpoint (generic device integration)
 */
export const cardTapAttendance = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { cardId, deviceId, timestamp } = req.body;

    // Validate device
    const device = await prisma.attendanceDevice.findUnique({ where: { deviceId } });
    if (!device || !device.isActive) { sendError(res, "Invalid or inactive device", 403); return; }

    // Find staff by cardId
    const staff = await prisma.staff.findUnique({ where: { cardId } });
    if (!staff) { sendError(res, "Card not registered to any staff", 404); return; }

    const tapTime = timestamp ? new Date(timestamp) : new Date();
    const today = new Date(tapTime.getFullYear(), tapTime.getMonth(), tapTime.getDate());

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
