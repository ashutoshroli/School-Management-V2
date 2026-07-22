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
export const resolveBranchId = (req: AuthRequest): string | undefined =>
  resolveEffectiveBranchId(req, req.query.branchId as string | undefined);

/**
 * Resolves the branchId a write (create) operation should actually use,
 * given whatever value the client sent (`requestedBranchId` - typically
 * `req.body.branchId`).
 *
 * BUG FIX: nearly every "create X" endpoint across this codebase
 * (academic years, classes/sections/subjects, staff, students, fee
 * categories/structures, chart-of-accounts/vouchers, notices, library
 * books, transport routes/vehicles, hostel buildings, inventory items,
 * ...) used to read `branchId` straight off `req.body` and pass it
 * directly to `canAccessBranch`/`prisma.create`. Every one of those
 * create forms in the frontend leaves `branchId` as an empty string
 * (`""`) - there's no branch-picker UI on any of them - which meant:
 *   - For a non-SUPER_ADMIN, `canAccessBranch(req, "")` is falsy
 *     (empty string is not the user's real branchId), so every one of
 *     these creates failed with a 403 "branch mismatch".
 *   - For a SUPER_ADMIN, `canAccessBranch` returns true unconditionally,
 *     so the create proceeded with `branchId: ""`, which Prisma/Postgres
 *     rejects as an invalid foreign key - surfacing as a generic 500
 *     ("Failed to create academic year", etc), exactly like the
 *     "Failed to create academic year" error this was diagnosed from.
 *
 * The fix: ignore an empty/falsy client-supplied branchId and fall back
 * to the caller's own branchId (same resolution SUPER_ADMIN already
 * gets a default branchId for at login - see auth.controller.ts). A
 * SUPER_ADMIN MAY still explicitly target a different branch by
 * actually sending one (e.g. from a future branch-picker UI) - only a
 * missing/blank value falls back.
 */
export const resolveEffectiveBranchId = (
  req: AuthRequest,
  requestedBranchId?: string | null
): string | undefined => {
  if (req.user?.role === UserRole.SUPER_ADMIN) {
    return requestedBranchId || req.user?.branchId || undefined;
  }
  // Non-SUPER_ADMIN: always their own branch - a client-supplied value
  // is never trusted anyway (canAccessBranch would reject a mismatch),
  // so resolving straight to req.user.branchId here (rather than the
  // raw request body) means "no branchId sent" and "sent my own
  // branchId" behave identically instead of the former failing.
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
  // Global bypass flag (spec Section 3) - a SUPER_ADMIN whose account
  // has bypassAllChecks explicitly set to false is NOT auto-granted
  // access here; every other SUPER_ADMIN (bypassAllChecks true/absent,
  // i.e. every account created before this flag existed) keeps the
  // original unconditional-access behavior. `bypassAllChecks` defaults
  // to `true` for new Super Admins at creation time (see
  // auth.controller.ts's login()/googleCallback(), which copy
  // User.bypassAllChecks into the JWT) so this is fully backward
  // compatible - only an account explicitly toggled off ever sees a
  // real branch check.
  if (req.user?.role === UserRole.SUPER_ADMIN && req.user?.bypassAllChecks !== false) return true;
  if (!resourceBranchId) return false;
  return resourceBranchId === req.user?.branchId;
};
