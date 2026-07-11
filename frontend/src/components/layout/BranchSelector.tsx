"use client";

import { useEffect, useState } from "react";
import { Building2, ChevronDown, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useBranch } from "@/hooks/useBranch";

/**
 * Header branch switcher.
 *
 * - SUPER_ADMIN: sees a dropdown of every branch in the org and can
 *   switch their "active branch" at any time. Every create/list
 *   endpoint auto-scopes to whatever branch is active (see
 *   useBranch.switchBranch's doc comment) - no per-page branch field
 *   needed anywhere else in the app.
 * - Everyone else (Branch Admin, Teacher, ...): permanently locked to
 *   the branch their Staff/Student record belongs to. Shown as a plain
 *   read-only label so it's still clear which branch's data they're
 *   looking at, with no way to change it (switch-branch is rejected
 *   server-side for non-Super-Admins anyway).
 */
export default function BranchSelector() {
  const { user } = useAuth();
  const { branches, loading, fetchBranches, switchBranch } = useBranch();
  const [switching, setSwitching] = useState(false);

  const isSuperAdmin = user?.role === "SUPER_ADMIN";

  useEffect(() => {
    if (isSuperAdmin) fetchBranches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin]);

  if (!user) return null;

  if (!isSuperAdmin) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-100 text-sm text-gray-700">
        <Building2 className="h-4 w-4 text-gray-500" />
        <span className="font-medium">{user.branchName || "No branch assigned"}</span>
      </div>
    );
  }

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const branchId = e.target.value;
    if (!branchId || branchId === user.branchId) return;

    setSwitching(true);
    try {
      await switchBranch(branchId);
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to switch branch");
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="relative flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary-50 border border-primary-200 text-sm">
      <Building2 className="h-4 w-4 text-primary-600 flex-shrink-0" />
      {switching || loading ? (
        <Loader2 className="h-4 w-4 text-primary-600 animate-spin" />
      ) : (
        <>
          <select
            value={user.branchId || ""}
            onChange={handleChange}
            disabled={switching}
            title="Switch active branch - all new records you create will be added to this branch"
            className="bg-transparent border-none text-sm font-medium text-primary-800 pr-6 focus:outline-none appearance-none cursor-pointer disabled:cursor-wait"
          >
            {branches.length === 0 && <option value={user.branchId || ""}>{user.branchName || "Select branch"}</option>}
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <ChevronDown className="h-3.5 w-3.5 text-primary-600 pointer-events-none absolute right-3" />
        </>
      )}
    </div>
  );
}
