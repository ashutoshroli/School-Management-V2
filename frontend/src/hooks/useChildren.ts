"use client";

import { create } from "zustand";
import api from "@/lib/api";

export interface Child {
  id: string;
  admissionNo: string;
  user: { name: string; email: string; avatar?: string };
  class?: { name: string };
  section?: { name: string };
  branch?: { name: string };
}

interface ChildrenState {
  children: Child[];
  selectedChildId: string | null;
  loading: boolean;
  fetchChildren: () => Promise<void>;
  selectChild: (id: string) => void;
}

/**
 * Shared state for the parent-portal "child switcher" - a PARENT may
 * have multiple children linked to their account, so every "My ..."
 * page (fees/attendance/homework/exams) needs to know which child is
 * currently selected. A STUDENT login will always have exactly one
 * "child" (themselves).
 */
export const useChildren = create<ChildrenState>((set, get) => ({
  children: [],
  selectedChildId: null,
  loading: false,

  fetchChildren: async () => {
    set({ loading: true });
    try {
      const res = await api.get("/parent/children");
      const children: Child[] = res.data.data || [];
      const current = get().selectedChildId;
      set({
        children,
        selectedChildId: current && children.some((c) => c.id === current) ? current : children[0]?.id || null,
        loading: false,
      });
    } catch {
      set({ loading: false });
    }
  },

  selectChild: (id: string) => set({ selectedChildId: id }),
}));
