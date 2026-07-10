import { UserRole } from "@prisma/client";
import { AuthRequest } from "../types";

/**
 * Resolve the branchId that a list/read query should be filtered by.
 *
 * SECURITY: Non SUPER_ADMIN users are always locked to their own branch.
 * Any `?branchId=` query param they pass is ignored - otherwise a
 * Branch Admin/Teacher/Accountant could read another branch's data simply
 * by changing the query string (IDOR).
 *
 * SUPER_ADMIN may optionally pass `?branchId=` to scope to a specific
 * branch, or omit it (caller decides how to treat "all branches").
 */
export const resolveBranchId = (req: AuthRequest): string | undefined => {
  const requested = req.query.branchId as string | undefined;

  if (req.user?.role === UserRole.SUPER_ADMIN) {
    return requested || req.user?.branchId || undefined;
  }

  return req.user?.branchId || undefined;
};

/**
 * Returns true if the current user is allowed to access a resource that
 * belongs to `resourceBranchId`. SUPER_ADMIN can access any branch.
 */
export const canAccessBranch = (
  req: AuthRequest,
  resourceBranchId?: string | null
): boolean => {
  if (req.user?.role === UserRole.SUPER_ADMIN) return true;
  if (!resourceBranchId) return false;
  return resourceBranchId === req.user?.branchId;
};
