"use client";

import { useAuth } from "@/hooks/useAuth";
import {
  GraduationCap,
  Users,
  IndianRupee,
  ClipboardCheck,
  TrendingUp,
  AlertCircle,
} from "lucide-react";

export default function DashboardPage() {
  const { user } = useAuth();

  // Placeholder stats - will be replaced with real API data in Phase 7
  const stats = [
    { label: "Total Students", value: "14,892", icon: GraduationCap, color: "bg-blue-100 text-blue-600" },
    { label: "Total Staff", value: "432", icon: Users, color: "bg-green-100 text-green-600" },
    { label: "Fee Collected (Month)", value: "Rs 45.2L", icon: IndianRupee, color: "bg-purple-100 text-purple-600" },
    { label: "Attendance Today", value: "94.2%", icon: ClipboardCheck, color: "bg-orange-100 text-orange-600" },
    { label: "Fee Pending", value: "Rs 12.8L", icon: AlertCircle, color: "bg-red-100 text-red-600" },
    { label: "Growth (YoY)", value: "+8.3%", icon: TrendingUp, color: "bg-emerald-100 text-emerald-600" },
  ];

  return (
    <div>
      {/* Page Title */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 mt-1">
          Overview for {user?.role === "SUPER_ADMIN" ? "All Branches" : "your branch"}
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="card flex items-center gap-4">
              <div className={`p-3 rounded-xl ${stat.color}`}>
                <Icon className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm text-gray-500">{stat.label}</p>
                <p className="text-xl font-bold text-gray-900">{stat.value}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Placeholder sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Recent Fee Collections</h3>
          <p className="text-gray-500 text-sm">Data will appear after Phase 2 (Fees Module) is completed.</p>
        </div>
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Today's Attendance</h3>
          <p className="text-gray-500 text-sm">Data will appear after Phase 4 (Attendance) is completed.</p>
        </div>
      </div>
    </div>
  );
}
