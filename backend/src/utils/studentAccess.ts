import { UserRole } from "@prisma/client";
import prisma from "../config/database";
import { AuthRequest } from "../types";

/**
 * Returns true if the current user is allowed to view/act on the given
 * student's data:
 *  - SUPER_ADMIN / BRANCH_ADMIN / ACCOUNTANT / TEACHER etc: branch-level
 *    staff access is handled separately via branchScope.canAccessBranch.
 *  - STUDENT: only their own student record.
 *  - PARENT: only a student that is one of their linked children.
 *
 * This exists because the online-payment endpoints (and the parent
 * portal) are reachable by STUDENT/PARENT roles, which don't have a
 * `branchId` staff-style scoping - without this check a parent/student
 * could pay for, or view, an arbitrary student by ID (IDOR).
 */
export const canAccessStudentRecord = async (
  req: AuthRequest,
  studentId: string
): Promise<boolean> => {
  const role = req.user?.role;
  const userId = req.user?.userId;
  if (!role || !userId) return false;

  if (
    role === UserRole.SUPER_ADMIN ||
    role === UserRole.BRANCH_ADMIN ||
    role === UserRole.ACCOUNTANT ||
    role === UserRole.TEACHER
  ) {
    // Staff roles: branch scoping is enforced separately by the caller
    // (canAccessBranch / branchAccess middleware) using the student's
    // branchId, so no further restriction here.
    return true;
  }

  if (role === UserRole.STUDENT) {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { userId: true },
    });
    return student?.userId === userId;
  }

  if (role === UserRole.PARENT) {
    const link = await prisma.studentParent.findFirst({
      where: { studentId, parent: { userId } },
    });
    return Boolean(link);
  }

  return false;
};

/**
 * Convenience helper: returns the list of student IDs the current
 * PARENT user is linked to as children. Empty array for any other role.
 */
export const getOwnChildStudentIds = async (req: AuthRequest): Promise<string[]> => {
  if (req.user?.role !== UserRole.PARENT || !req.user.userId) return [];
  const links = await prisma.studentParent.findMany({
    where: { parent: { userId: req.user.userId } },
    select: { studentId: true },
  });
  return links.map((l) => l.studentId);
};
