import { Response } from "express";
import { UserRole } from "@prisma/client";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { resolveBranchId, canAccessBranch } from "../utils/branchScope";
import { canAccessStaffRecord } from "../utils/staffAccess";

/**
 * Role-wise AND branch-wise leave quota resolution (spec Section 7) -
 * checks for a LeaveRoleQuota override for this exact
 * (branchId, role, leaveTypeId) combination first, falling back to
 * LeaveType.maxDays (the original single-quota behavior) when no
 * override has been configured. Fully backward compatible: a branch
 * that never configures LeaveRoleQuota rows behaves exactly as before.
 */
const resolveLeaveQuota = async (branchId: string, role: UserRole, leaveTypeId: string, fallbackMaxDays: number): Promise<number> => {
  const override = await prisma.leaveRoleQuota.findUnique({
    where: { branchId_role_leaveTypeId: { branchId, role, leaveTypeId } },
  });
  return override?.maxDays ?? fallbackMaxDays;
};

/**
 * Determines the starting approval level for a NEW leave application
 * (spec Section 7 - "2-level approval chain: Staff -> VP -> Principal;
 * VP/Principal's own leave -> Director; Director approves his own
 * leave himself"). BRANCH_ADMIN is treated as "Director" per the
 * spec's terminology (there is no separate DIRECTOR UserRole in this
 * codebase - BRANCH_ADMIN/Admin IS the branch's Director, see the
 * spec's Roles & Permissions section).
 */
const resolveInitialApprovalLevel = (role: UserRole): "VP" | "PRINCIPAL" | "DIRECTOR" | "DONE" => {
  if (role === UserRole.BRANCH_ADMIN || role === UserRole.SUPER_ADMIN) return "DONE"; // self-approved
  if (role === UserRole.VICE_PRINCIPAL || role === UserRole.PRINCIPAL) return "DIRECTOR";
  return "VP";
};

/**
 * Marks attendance ON_LEAVE for every date in [fromDate, toDate] -
 * shared by every path that fully approves a leave application
 * (chain-based advanceLeaveApproval, the admin-override
 * updateLeaveStatus/bulkUpdateLeaveStatus, and self-approval on apply).
 */
const markAttendanceOnLeave = async (staffId: string, fromDate: Date, toDate: Date): Promise<void> => {
  for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
    const dateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    await prisma.staffAttendance.upsert({
      where: { staffId_date: { staffId, date: dateOnly } },
      update: { status: "ON_LEAVE" },
      create: { staffId, date: dateOnly, status: "ON_LEAVE", source: "MANUAL" },
    });
  }
};

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
 * Get single leave type detail, with how many applications have
 * used it - useful context on the management UI (e.g. before
 * deciding to deactivate vs. attempting a delete, which
 * deleteLeaveType blocks outright once any application exists).
 * LeaveType has no branchId (system-wide, see the model's doc
 * comment above) so this is available to any authenticated user,
 * matching getLeaveTypes.
 */
export const getLeaveTypeById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const type = await prisma.leaveType.findUnique({ where: { id } });
    if (!type) { sendError(res, "Leave type not found", 404); return; }

    const applicationCount = await prisma.leaveApplication.count({ where: { leaveTypeId: id } });

    sendSuccess(res, { ...type, applicationCount }, "Leave type fetched");
  } catch (error) { sendError(res, "Failed to fetch leave type", 500, (error as Error).message); }
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
 *
 * Sets the 2-level approval chain's starting point (spec Section 7)
 * based on the applicant's OWN role: a plain Staff/Teacher starts at
 * VP, a VP/Principal's own leave starts at DIRECTOR, and a
 * BRANCH_ADMIN/SUPER_ADMIN ("Director") self-approves immediately -
 * see resolveInitialApprovalLevel's doc comment. Leave quota is
 * resolved role-wise AND branch-wise (LeaveRoleQuota override, falling
 * back to LeaveType.maxDays) instead of always using the single
 * system-wide quota.
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

    const maxDays = await resolveLeaveQuota(staff.branchId, req.user!.role, leaveTypeId, leaveType.maxDays);

    const yearStart = new Date(new Date().getFullYear(), 0, 1);
    const used = await prisma.leaveApplication.aggregate({
      where: { staffId: staff.id, leaveTypeId, status: { in: ["APPROVED", "PENDING"] }, fromDate: { gte: yearStart } },
      _sum: { days: true },
    });
    const usedDays = used._sum.days || 0;
    if (usedDays + days > maxDays) {
      sendError(res, `Insufficient balance. Used: ${usedDays}, Requesting: ${days}, Max: ${maxDays}`, 400);
      return;
    }

    const initialLevel = resolveInitialApprovalLevel(req.user!.role);
    const isSelfApproved = initialLevel === "DONE";

    const application = await prisma.leaveApplication.create({
      data: {
        staffId: staff.id, leaveTypeId, fromDate: from, toDate: to, days, reason,
        status: isSelfApproved ? "APPROVED" : "PENDING",
        currentApprovalLevel: initialLevel,
        ...(isSelfApproved && { approvedBy: userId }),
      },
    });

    // Director approving his own leave (spec Section 7) auto-marks
    // attendance ON_LEAVE immediately, same as any other fully-
    // approved application.
    if (isSelfApproved) {
      await markAttendanceOnLeave(staff.id, from, to);
    }

    sendSuccess(res, application, isSelfApproved ? "Leave self-approved" : "Leave applied successfully", 201);
  } catch (error) { sendError(res, "Failed to apply leave", 500, (error as Error).message); }
};

/**
 * Advance a leave application through the 2-level approval chain
 * (spec Section 7) - replaces the old single-step updateLeaveStatus
 * for the normal chain flow (updateLeaveStatus/bulkUpdateLeaveStatus
 * below are kept as a direct admin-override escape hatch, still
 * useful for a Branch Admin who needs to force a decision outside the
 * chain). A REJECTED decision at ANY level immediately ends the chain
 * (status REJECTED) - rejection never cascades further up.
 *
 * VP action (currentApprovalLevel === VP): approving advances to
 * PRINCIPAL; rejecting ends it.
 * Principal action (currentApprovalLevel === PRINCIPAL): approving
 * marks the application fully APPROVED (marks attendance ON_LEAVE);
 * rejecting ends it.
 * Director action (currentApprovalLevel === DIRECTOR, i.e. a VP's or
 * Principal's own leave): approving marks it fully APPROVED directly
 * (no further level); rejecting ends it.
 */
export const advanceLeaveApproval = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { decision, remarks } = req.body; // "APPROVE" | "REJECT"

    const application = await prisma.leaveApplication.findUnique({
      where: { id },
      include: { staff: { select: { branchId: true } } },
    });
    if (!application) { sendError(res, "Leave application not found", 404); return; }
    if (!canAccessBranch(req, application.staff.branchId)) { sendError(res, "Leave application not found", 404); return; }
    if (application.status !== "PENDING") { sendError(res, "This application has already been decided", 400); return; }

    const approverId = req.user!.userId;
    const level = application.currentApprovalLevel;

    if (decision === "REJECT") {
      const updated = await prisma.leaveApplication.update({
        where: { id },
        data: {
          status: "REJECTED",
          remarks,
          approvedBy: approverId,
          ...(level === "VP" && { vpApprovedBy: approverId, vpApprovedAt: new Date(), vpRemarks: remarks }),
          ...(level === "PRINCIPAL" && { principalApprovedBy: approverId, principalApprovedAt: new Date(), principalRemarks: remarks }),
        },
      });
      sendSuccess(res, updated, "Leave rejected");
      return;
    }

    if (level === "VP") {
      const updated = await prisma.leaveApplication.update({
        where: { id },
        data: { currentApprovalLevel: "PRINCIPAL", vpApprovedBy: approverId, vpApprovedAt: new Date(), vpRemarks: remarks },
      });
      sendSuccess(res, updated, "Approved by VP - forwarded to Principal");
      return;
    }

    if (level === "PRINCIPAL" || level === "DIRECTOR") {
      const updated = await prisma.leaveApplication.update({
        where: { id },
        data: {
          status: "APPROVED",
          currentApprovalLevel: "DONE",
          approvedBy: approverId,
          ...(level === "PRINCIPAL" && { principalApprovedBy: approverId, principalApprovedAt: new Date(), principalRemarks: remarks }),
        },
      });
      await markAttendanceOnLeave(application.staffId, application.fromDate, application.toDate);
      sendSuccess(res, updated, "Leave fully approved");
      return;
    }

    sendError(res, "This application has already completed its approval chain", 400);
  } catch (error) {
    sendError(res, "Failed to advance leave approval", 500, (error as Error).message);
  }
};

/**
 * Substitute/cover-teacher assignment for one period on one day arising
 * from an approved LeaveApplication (spec Section 7) - supports both
 * manual assignment (this endpoint, called directly with a chosen
 * substituteStaffId) and system auto-suggest (see
 * suggestSubstituteTeachers below, which a caller can use to populate
 * a picker before calling this to confirm one).
 */
export const assignSubstituteTeacher = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { leaveApplicationId, date, timetableSlotId, substituteStaffId, isAutoSuggested } = req.body;

    const application = await prisma.leaveApplication.findUnique({
      where: { id: leaveApplicationId },
      include: { staff: { select: { branchId: true } } },
    });
    if (!application) { sendError(res, "Leave application not found", 404); return; }
    if (!canAccessBranch(req, application.staff.branchId)) { sendError(res, "Leave application not found", 404); return; }
    if (application.status !== "APPROVED") { sendError(res, "Substitutes can only be assigned for an approved leave", 400); return; }

    const substitute = await prisma.staff.findUnique({ where: { id: substituteStaffId }, select: { branchId: true } });
    if (!substitute || substitute.branchId !== application.staff.branchId) {
      sendError(res, "Substitute teacher must belong to the same branch", 400);
      return;
    }

    const assignment = await prisma.leaveSubstituteAssignment.upsert({
      where: { timetableSlotId_date: { timetableSlotId, date: new Date(date) } },
      update: { substituteStaffId, isAutoSuggested: !!isAutoSuggested, leaveApplicationId },
      create: { leaveApplicationId, date: new Date(date), timetableSlotId, substituteStaffId, isAutoSuggested: !!isAutoSuggested },
    });
    sendSuccess(res, assignment, "Substitute teacher assigned", 201);
  } catch (error) {
    sendError(res, "Failed to assign substitute teacher", 500, (error as Error).message);
  }
};

/**
 * System auto-suggest for substitute teachers (spec Section 7 -
 * "supports both system auto-suggest and manual assignment") - for one
 * specific timetable slot (day+period), suggests staff members who are
 * (a) free at that exact day/period (no timetable slot of their own
 * then) and (b) not already on approved leave themselves that day.
 * Returns a plain suggestion list; assignSubstituteTeacher above still
 * needs to be called separately to actually confirm one.
 */
export const suggestSubstituteTeachers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { timetableSlotId, date } = req.query;
    if (!timetableSlotId || !date) { sendError(res, "timetableSlotId and date are required", 400); return; }

    const slot = await prisma.timetableSlot.findUnique({
      where: { id: timetableSlotId as string },
      include: { timetable: { select: { section: { select: { branchId: true } } } } },
    });
    if (!slot) { sendError(res, "Timetable slot not found", 404); return; }
    const branchId = slot.timetable.section.branchId;
    if (!canAccessBranch(req, branchId)) { sendError(res, "Timetable slot not found", 404); return; }

    const attendanceDate = new Date(date as string);

    const [busyTeachers, onLeaveStaff] = await Promise.all([
      prisma.timetableSlot.findMany({
        where: { day: slot.day, period: slot.period, teacherId: { not: null } },
        select: { teacherId: true },
      }),
      prisma.leaveApplication.findMany({
        where: { status: "APPROVED", fromDate: { lte: attendanceDate }, toDate: { gte: attendanceDate } },
        select: { staffId: true },
      }),
    ]);
    const unavailableIds = new Set([
      ...busyTeachers.map((t) => t.teacherId as string),
      ...onLeaveStaff.map((l) => l.staffId),
    ]);

    const available = await prisma.staff.findMany({
      where: { branchId, isActive: true, type: "TEACHING", id: { notIn: [...unavailableIds] } },
      include: { user: { select: { name: true } } },
      orderBy: { user: { name: "asc" } },
      take: 20,
    });

    sendSuccess(res, available, "Suggested substitute teachers fetched");
  } catch (error) {
    sendError(res, "Failed to suggest substitute teachers", 500, (error as Error).message);
  }
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
    const leaveTypeId = req.query.leaveTypeId as string;
    const fromDate = req.query.fromDate as string;
    const toDate = req.query.toDate as string;
    const branchId = resolveBranchId(req);

    if (staffId && !(await canAccessStaffRecord(req, staffId))) {
      sendError(res, "Staff not found", 404);
      return;
    }

    const where: any = {};
    if (staffId) where.staffId = staffId;
    if (status) where.status = status;
    if (leaveTypeId) where.leaveTypeId = leaveTypeId;
    if (branchId && !staffId) where.staff = { branchId };
    // Date range: any application overlapping [fromDate, toDate] - not
    // just applications whose own fromDate falls inside the range, so
    // a multi-day leave that merely started earlier still shows up
    // when browsing "leave in June" even if it began in late May.
    if (fromDate) where.toDate = { gte: new Date(fromDate) };
    if (toDate) where.fromDate = { ...(where.fromDate || {}), lte: new Date(toDate) };

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
 * Bulk approve/reject a hand-picked list of PENDING leave applications
 * in one call - the multi-select counterpart to updateLeaveStatus
 * below (which handles one application at a time). Each application
 * still needs its own attendance-marking side effect when approved
 * (see updateLeaveStatus's ON_LEAVE upsert loop), and different
 * applications can span different staff/date-ranges, so this loops
 * per application rather than a single bulk updateMany - unlike
 * bulkPromote/bulkAssignSalaryStructure, the per-row side effects here
 * genuinely differ row-to-row, so there's no safe way to collapse it
 * into one statement.
 */
export const bulkUpdateLeaveStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { applicationIds, status, remarks } = req.body;

    if (!Array.isArray(applicationIds) || applicationIds.length === 0) {
      sendError(res, "applicationIds must be a non-empty array", 400);
      return;
    }

    const applications = await prisma.leaveApplication.findMany({
      where: { id: { in: applicationIds } },
      include: { staff: { select: { branchId: true } } },
    });

    const foundIds = new Set(applications.map((a) => a.id));
    const notFound = applicationIds.filter((id: string) => !foundIds.has(id));

    // SECURITY: every application's staff member must belong to a
    // branch the caller can access - same IDOR class already fixed on
    // getLeaveApplications/getLeaveBalance above, just for the bulk
    // approval path. Combined with "must currently be PENDING" (can't
    // re-approve/reject an already-decided application) to determine
    // which applications this call actually touches.
    const eligible = applications.filter((a) => a.status === "PENDING" && canAccessBranch(req, a.staff.branchId));

    if (eligible.length === 0) {
      sendSuccess(
        res,
        { updated: 0, skipped: applications.length, notFound: notFound.length, total: applicationIds.length },
        "No eligible pending applications to update"
      );
      return;
    }

    await prisma.leaveApplication.updateMany({
      where: { id: { in: eligible.map((a) => a.id) } },
      data: { status, remarks, approvedBy: req.user!.userId },
    });

    if (status === "APPROVED") {
      for (const application of eligible) {
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
    }

    const skipped = applications.length - eligible.length;
    sendSuccess(
      res,
      { updated: eligible.length, skipped, notFound: notFound.length, total: applicationIds.length },
      `${eligible.length} application(s) ${status.toLowerCase()}` +
        (skipped > 0 ? ` (${skipped} skipped - not pending or not accessible)` : "")
    );
  } catch (error) {
    sendError(res, "Failed to bulk-update leave status", 500, (error as Error).message);
  }
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
