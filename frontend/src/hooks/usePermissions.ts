"use client";

import { useAuth } from "./useAuth";

/**
 * Point 4 (Role-Based Permissions): centralizes the "can this user
 * Edit/Delete here" decision so every module/page checks the SAME
 * rule instead of each page hand-rolling its own (or, as several
 * pages did before this hook existed, not checking at all and always
 * rendering Edit/Delete buttons regardless of role).
 *
 * Rules (as specified):
 *   - SUPER_ADMIN: Edit AND Delete everywhere, no module/page/section
 *     ever hides these from a Super Admin.
 *   - BRANCH_ADMIN (the app's "Admin" role - there is no separate
 *     literal "ADMIN" UserRole in this schema): Edit everywhere.
 *     Delete is intentionally NOT granted by this rule alone - several
 *     existing backend routes already restrict certain deletes to
 *     SUPER_ADMIN only (e.g. removing a whole Branch); canDelete
 *     reflects the two roles that already have broad delete access
 *     app-wide (SUPER_ADMIN always, BRANCH_ADMIN for their own
 *     branch's data - matching what the backend's `authorize(...ADMIN)`
 *     middleware already permits on every delete route today).
 *   - Everyone else (Teacher, Accountant, Librarian, Principal, etc.):
 *     no Edit/Delete via this hook - those roles were never shown
 *     Edit/Delete controls before this change either; this hook simply
 *     makes that consistent everywhere instead of ad-hoc/missing.
 *
 * IMPORTANT: this is a UI-convenience layer only. The backend's
 * `authorize(...)` middleware on each route is the actual security
 * boundary (see backend/src/middleware/auth.ts) - hiding a button here
 * never substitutes for a server-side check, and every route this
 * hook's buttons call already enforces its own role check
 * independently.
 */
export const usePermissions = () => {
  const { user } = useAuth();
  const role = user?.role;

  const isSuperAdmin = role === "SUPER_ADMIN";
  const isBranchAdmin = role === "BRANCH_ADMIN";
  const isAdmin = isSuperAdmin || isBranchAdmin;

  return {
    role,
    isSuperAdmin,
    isBranchAdmin,
    isAdmin,
    /** Super Admin: always. Branch Admin ("Admin"): always. */
    canEdit: isAdmin,
    /** Super Admin: always. Branch Admin: yes (matches existing backend authorize(...ADMIN) delete routes). */
    canDelete: isAdmin,
    /** Delete restricted to Super Admin only (a handful of org-wide/destructive actions already backend-gated this way). */
    canDeleteSuperAdminOnly: isSuperAdmin,
  };
};
