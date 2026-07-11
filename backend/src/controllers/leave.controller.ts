import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { resolveBranchId, canAccessBranch } from "../utils/branchScope";
import { canAccessStaffRecord } from "../utils/staffAccess";

/**
 * Get leave types. `includeInactive=true` is for the admin-facing
 * management UI (which needs to show/re-enable a deactivated type);
 * every other caller (the leave-apply form, balance lookups) should
 * keep seeing only active types, unchanged from before.
 */
export const getLeaveTypes = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const includeInactive = req.query.includeInactive === "true";
    const types = await prisma.leaveType.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { name: "asc" },
    });
    sendSuccess(res, types, "Leave types fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Create a leave type (e.g. a school adding "Sabbatical Leave").
 * `LeaveType` has no `branchId` in the schema - it's a single,
 * system-wide list shared by every branch, same as `GradeSystem` -
 * so this is ADMIN-only rather than branch-scoped.
 */
export const createLeaveType = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, code, maxDays, carryForward } = req.body;

    const existing = await prisma.leaveType.findUnique({ where: { code } });
    if (existing) { sendError(res, "A leave type with this code already exists", 400); return; }

    const type = await prisma.leaveType.create({
      data: { name, code, maxDays, carryForward: !!carryForward, isActive: true },
    });
    sendSuccess(res, type, "Leave type created", 201);
  } catch (error) { sendError(res, "Failed to create leave type", 500, (error as Error).message); }
};

/**
 * Update a leave type's name/quota/carry-forward, or toggle isActive.
 * `code` is intentionally not editable here - it's the stable key used
 * to look up a type (and is unique), so changing it is more like
 * creating a new type; delete and recreate instead if truly needed.
 */
export const updateLeaveType = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, maxDays, carryForward, isActive } = req.body;

    const existing = await prisma.leaveType.findUnique({ where: { id } });
    if (!existing) { sendError(res, "Leave type not found", 404); return; }

    const updated = await prisma.leaveType.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(maxDays !== undefined && { maxDays }),
        ...(carryForward !== undefined && { carryForward }),
        ...(isActive !== undefined && { isActive }),
      },
    });
    sendSuccess(res, updated, "Leave type updated");
  } catch (error) { sendError(res, "Failed to update leave type", 500, (error as Error).message); }
};

/**
 * Delete a leave type. Blocked if any LeaveApplication already
 * references it - that's real leave history that must never silently
 * disappear (same "block delete, don't cascade" convention used by
 * deleteFeeCategory/deleteExam elsewhere in this codebase). Deactivate
 * via updateLeaveType instead if the goal is just to stop new
 * applications against it.
 */
export const deleteLeaveType = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const existing = await prisma.leaveType.findUnique({ where: { id } });
    if (!existing) { sendError(res, "Leave type not found", 404); return; }

    const applicationCount = await prisma.leaveApplication.count({ where: { leaveTypeId: id } });
    if (applicationCount > 0) {
      sendError(res, `Cannot delete: ${applicationCount} leave application(s) use this type. Deactivate it instead.`, 400);
      return;
    }

    await prisma.leaveType.delete({ where: { id } });
    sendSuccess(res, null, "Leave type deleted");
  } catch (error) { sendError(res, "Failed to delete leave type", 500, (error as Error).message); }
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
 *
 * SECURITY: when a `staffId` query param was supplied, this used to
 * skip branch scoping ENTIRELY (`if (branchId && !staffId) ...`) with
 * no ownership check either - any authenticated user (e.g. a Teacher)
 * could pass `?staffId=<anyone>` and read that staff member's full
 * leave application history (including their stated `reason`), even
 * for staff in a completely different branch (IDOR).
 */
export const getLeaveApplications = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const staffId = req.query.staffId as string;
    const status = req.query.status as string;
    const branchId = resolveBranchId(req);

    if (staffId && !(await canAccessStaffRecord(req, staffId))) {
      sendError(res, "Staff not found", 404);
      return;
    }

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
 *
 * SECURITY: when a real staffId (not "self") was supplied, this had no
 * access check at all - same IDOR class as getLeaveApplications above.
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
    if (!(await canAccessStaffRecord(req, staffId))) { sendError(res, "Staff not found", 404); return; }

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
