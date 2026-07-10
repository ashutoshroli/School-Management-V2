"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { getNavForRole } from "@/lib/navigation";
import { useAuth } from "@/hooks/useAuth";
import * as Icons from "lucide-react";
import { LucideIcon, Circle } from "lucide-react";

export default function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuth();

  if (!user) return null;

  const navItems = getNavForRole(user.role);

  const getIcon = (iconName: string): LucideIcon => {
    // `lucide-react`'s namespace export includes some non-icon members
    // (e.g. `icons`, type helpers) whose types don't cleanly overlap
    // with `Record<string, LucideIcon>` on newer versions of the
    // package - narrow through `unknown` first rather than fighting the
    // exact shape, since this is just a runtime string->component lookup.
    const icon = (Icons as unknown as Record<string, LucideIcon | undefined>)[iconName];
    return icon || Circle;
  };

  return (
    <aside className="fixed left-0 top-0 h-screen w-64 bg-sidebar-bg flex flex-col z-50">
      {/* Logo / Brand */}
      <div className="p-4 border-b border-gray-700">
        <h1 className="text-xl font-bold text-white">School ERP</h1>
        <p className="text-xs text-gray-400 mt-1">Management System</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-2">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const Icon = getIcon(item.icon);
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200",
                    isActive
                      ? "bg-sidebar-active text-white font-medium"
                      : "text-sidebar-text hover:bg-sidebar-hover"
                  )}
                >
                  <Icon className="h-5 w-5 flex-shrink-0" />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* User Info */}
      <div className="p-4 border-t border-gray-700">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center text-white text-sm font-medium">
            {user.name?.charAt(0)?.toUpperCase() || "U"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white truncate">{user.name}</p>
            <p className="text-xs text-gray-400 truncate">{user.role.replace("_", " ")}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
