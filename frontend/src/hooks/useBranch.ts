"use client";

import { create } from "zustand";
import api from "@/lib/api";
import { Branch } from "@/types";
import { useAuth } from "./useAuth";

interface BranchState {
  /** All branches the current user is allowed to see (Super Admin: all; others: just their own). */
  branches: Branch[];
  loading: boolean;
  fetchBranches: () => Promise<void>;
  /**
   * SUPER_ADMIN only. Every "create X" endpoint across this app resolves
   * its branchId server-side from the caller's JWT (see
   * resolveEffectiveBranchId in backend/src/utils/branchScope.ts) rather
   * than trusting a client-supplied value - none of the create forms
   * have (or need) a branch-picker field. That means switching a Super
   * Admin's "active branch" here, which re-issues their JWT with a new
   * branchId via POST /auth/switch-branch, is what actually makes every
   * subsequent create/list request auto-target the newly selected
   * branch - no per-form wiring required.
   */
  switchBranch: (branchId: string) => Promise<void>;
}

export const useBranch = create<BranchState>((set) => ({
  branches: [],
  loading: false,

  fetchBranches: async () => {
    set({ loading: true });
    try {
      const res = await api.get("/branches", { params: { limit: 100 } });
      set({ branches: res.data.data || [], loading: false });
    } catch {
      set({ loading: false });
    }
  },

  switchBranch: async (branchId: string) => {
    const res = await api.post("/auth/switch-branch", { branchId });
    const { accessToken, refreshToken, branchId: newBranchId, branchName } = res.data.data;

    // Re-issue the auth store's user/token with the new branchId baked
    // into the fresh JWT - every subsequent API call (via the
    // Authorization header interceptor in lib/api.ts) now carries the
    // new branch context automatically.
    const { user, setAuth } = useAuth.getState();
    if (user) {
      setAuth({ ...user, branchId: newBranchId, branchName }, accessToken);
    }
    // Store refresh token for future use
    if (refreshToken) {
      localStorage.setItem("refreshToken", refreshToken);
    }
  },
}));
