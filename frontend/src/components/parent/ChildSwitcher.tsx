"use client";

import { useEffect } from "react";
import { Users } from "lucide-react";
import { useChildren } from "@/hooks/useChildren";

/**
 * Dropdown for switching between a parent's linked children. Renders
 * nothing (just triggers the fetch) if there's only one child/self,
 * since a switcher isn't useful in that case.
 */
export default function ChildSwitcher() {
  const { children, selectedChildId, loading, fetchChildren, selectChild } = useChildren();

  useEffect(() => {
    fetchChildren();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <div className="h-9 w-48 bg-gray-100 animate-pulse rounded-lg" />;
  }

  if (children.length === 0) {
    return (
      <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
        No student record is linked to your account yet. Please contact the school office.
      </p>
    );
  }

  if (children.length === 1) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-600">
        <Users className="h-4 w-4" />
        <span className="font-medium text-gray-900">{children[0].user.name}</span>
        <span className="text-gray-400">
          {children[0].class?.name} - {children[0].section?.name}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Users className="h-4 w-4 text-gray-500" />
      <select
        className="input-field w-auto"
        value={selectedChildId || ""}
        onChange={(e) => selectChild(e.target.value)}
      >
        {children.map((c) => (
          <option key={c.id} value={c.id}>
            {c.user.name} ({c.class?.name} - {c.section?.name})
          </option>
        ))}
      </select>
    </div>
  );
}
