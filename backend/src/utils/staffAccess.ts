import prisma from "../config/database";
import { AuthRequest } from "../types";
import { canAccessBranch } from "./branchScope";

/**
 * Returns true if the current user is allowed to view a given staff
 * member's HR data (salary structure, payslips, attendance calendar,
 * leave balance/applications):
 *  - Branch-level staff (Super Admin, or any staff member within the
 *    same branch as the target - matches every other branch-scoped
 *    read in this codebase) via canAccessBranch.
 *  - The staff member themselves, viewing their OWN record (self-
 *    service - e.g. a Teacher checking their own leave balance).
 *
 * SECURITY: several HR endpoints (getSalaryStructure, getStaffPayslip,
 * getAttendanceCalendar, getLeaveBalance, getLeaveApplications by
 * staffId) previously had NO access check at all beyond `authenticate`
 * - any logged-in user (e.g. a Teacher) could read ANY other staff
 * member's salary, payslip, attendance, or leave data just by
 * supplying their staffId in the URL/query, including staff in a
 * completely different branch (IDOR + sensitive-data leak, since
 * salary is exactly the kind of data that must be need-to-know).
 */
export const canAccessStaffRecord = async (
  req: AuthRequest,
  staffId: string
): Promise<boolean> => {
  const userId = req.user?.userId;
  if (!userId) return false;

  const staff = await prisma.staff.findUnique({
    where: { id: staffId },
    select: { branchId: true, userId: true },
  });
  if (!staff) return false;

  if (canAccessBranch(req, staff.branchId)) return true;
  return staff.userId === userId;
};
