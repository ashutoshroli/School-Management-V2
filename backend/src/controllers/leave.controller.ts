import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { resolveBranchId, canAccessBranch } from "../utils/branchScope";

/**
 * Get leave types
 */
export const getLeaveTypes = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const types = await prisma.leaveType.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
    sendSuccess(res, types, "Leave types fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Apply for leave (staff self-service)
 */
export const applyLeave = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { leaveTypeId, fromDate, toDate, reason } = req.body;
    const userId = req.user!.userId;

    const staff = await prisma.staff.findUnique({ where: { userId } });
    if (!staff) { sendError(res, "Staff record not found", 404); return; }

    const from = new Date(fromDate);
    const to = new Date(toDate);
    const days = Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    // Check leave balance
    const leaveType = await prisma.leaveType.findUnique({ where: { id: leaveTypeId } });
    if (!leaveType) { sendError(res, "Invalid leave type", 400); return; }

    const yearStart = new Date(new Date().getFullYear(), 0, 1);
    const used = await prisma.leaveApplication.aggregate({
      where: { staffId: staff.id, leaveTypeId, status: { in: ["APPROVED", "PENDING"] }, fromDate: { gte: yearStart } },
      _sum: { days: true },
    });
    const usedDays = used._sum.days || 0;
    if (usedDays + days > leaveType.maxDays) {
      sendError(res, `Insufficient balance. Used: ${usedDays}, Requesting: ${days}, Max: ${leaveType.maxDays}`, 400);
      return;
    }

    const application = await prisma.leaveApplication.create({
      data: { staffId: staff.id, leaveTypeId, fromDate: from, toDate: to, days, reason, status: "PENDING" },
    });

    sendSuccess(res, application, "Leave applied successfully", 201);
  } catch (error) { sendError(res, "Failed to apply leave", 500, (error as Error).message); }
};

/**
 * Get leave applications (admin view or self view)
 */
export const getLeaveApplications = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const staffId = req.query.staffId as string;
    const status = req.query.status as string;
    const branchId = resolveBranchId(req);

    const where: any = {};
    if (staffId) where.staffId = staffId;
    if (status) where.status = status;
    if (branchId && !staffId) where.staff = { branchId };

    const applications = await prisma.leaveApplication.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        staff: { include: { user: { select: { name: true } } } },
        leaveType: { select: { name: true, code: true } },
      },
    });

    sendSuccess(res, applications, "Leave applications fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Approve/Reject leave
 */
export const updateLeaveStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, remarks } = req.body; // APPROVED or REJECTED

    const application = await prisma.leaveApplication.findUnique({ where: { id } });
    if (!application) { sendError(res, "Not found", 404); return; }
    if (application.status !== "PENDING") { sendError(res, "Can only update pending applications", 400); return; }

    const updated = await prisma.leaveApplication.update({
      where: { id },
      data: { status, remarks, approvedBy: req.user!.userId },
    });

    // If approved, mark attendance as ON_LEAVE for those dates
    if (status === "APPROVED") {
      const from = new Date(application.fromDate);
      const to = new Date(application.toDate);
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        const dateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        await prisma.staffAttendance.upsert({
          where: { staffId_date: { staffId: application.staffId, date: dateOnly } },
          update: { status: "ON_LEAVE" },
          create: { staffId: application.staffId, date: dateOnly, status: "ON_LEAVE", source: "MANUAL" },
        });
      }
    }

    sendSuccess(res, updated, `Leave ${status.toLowerCase()}`);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Get leave balance for a staff
 */
export const getLeaveBalance = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // BUG FIX: the frontend's "Leave Balance" tab (for a staff member
    // viewing their own balance) calls GET /hr/leave/balance/self -
    // "self" was previously used as a literal :staffId, so the query
    // below matched zero LeaveApplication rows (a real Staff.id never
    // equals the string "self") and silently returned every leave type
    // at its full, unused balance instead of the caller's real usage.
    // Resolve "self" (or a missing/blank param) to the caller's own
    // Staff record instead of trusting it as a real id.
    const requestedStaffId = req.params.staffId;
    const staffId =
      requestedStaffId && requestedStaffId !== "self"
        ? requestedStaffId
        : (await prisma.staff.findUnique({ where: { userId: req.user!.userId } }))?.id;
    if (!staffId) { sendError(res, "Staff not found", 404); return; }

    const leaveTypes = await prisma.leaveType.findMany({ where: { isActive: true } });
    const yearStart = new Date(new Date().getFullYear(), 0, 1);

    const balances = await Promise.all(leaveTypes.map(async (lt) => {
      const used = await prisma.leaveApplication.aggregate({
        where: { staffId, leaveTypeId: lt.id, status: "APPROVED", fromDate: { gte: yearStart } },
        _sum: { days: true },
      });
      return { leaveType: lt.name, code: lt.code, maxDays: lt.maxDays, used: used._sum.days || 0, remaining: lt.maxDays - (used._sum.days || 0) };
    }));

    sendSuccess(res, balances, "Leave balance fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};
