"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useChildren } from "@/hooks/useChildren";
import api from "@/lib/api";
import ChildSwitcher from "@/components/parent/ChildSwitcher";
import {
  GraduationCap,
  Users,
  IndianRupee,
  ClipboardCheck,
  TrendingUp,
  AlertCircle,
  BookOpen,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import Link from "next/link";

function AdminDashboard({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  // Placeholder stats - a real branch/org-wide analytics endpoint is
  // tracked as a follow-up (see reports.controller.ts for existing
  // per-module report endpoints that could be aggregated here).
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
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 mt-1">Overview for {isSuperAdmin ? "All Branches" : "your branch"}</p>
      </div>

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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Recent Fee Collections</h3>
          <p className="text-gray-500 text-sm">See the Fees module for detailed collection records.</p>
        </div>
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Today's Attendance</h3>
          <p className="text-gray-500 text-sm">See the Attendance module for class-wise records.</p>
        </div>
      </div>
    </div>
  );
}

function ParentDashboard() {
  const { user } = useAuth();
  const { children, selectedChildId, fetchChildren } = useChildren();
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const selectedChild = children.find((c) => c.id === selectedChildId);

  useEffect(() => {
    fetchChildren();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedChildId) return;
    setLoading(true);
    api
      .get(`/parent/children/${selectedChildId}/summary`)
      .then((res) => setSummary(res.data.data))
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, [selectedChildId]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Welcome, {user?.name?.split(" ")[0]}
          </h1>
          <p className="text-gray-500 mt-1">
            {user?.role === "PARENT" ? "Here's how your child is doing" : "Here's your overview"}
          </p>
        </div>
        <ChildSwitcher />
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
        </div>
      ) : summary ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Link href="/dashboard/my-fees" className="card flex items-center gap-4 hover:shadow-md transition-shadow">
            <div className="p-3 rounded-xl bg-red-100 text-red-600">
              <IndianRupee className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Pending Fees</p>
              <p className="text-xl font-bold text-gray-900">{formatCurrency(summary.pendingFeeTotal)}</p>
            </div>
          </Link>
          <Link href="/dashboard/my-attendance" className="card flex items-center gap-4 hover:shadow-md transition-shadow">
            <div className="p-3 rounded-xl bg-blue-100 text-blue-600">
              <ClipboardCheck className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Attendance (This Month)</p>
              <p className="text-xl font-bold text-gray-900">
                {summary.attendancePercentage !== null ? `${summary.attendancePercentage}%` : "No data"}
              </p>
            </div>
          </Link>
          <Link href="/dashboard/my-homework" className="card flex items-center gap-4 hover:shadow-md transition-shadow">
            <div className="p-3 rounded-xl bg-purple-100 text-purple-600">
              <BookOpen className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Pending Homework</p>
              <p className="text-xl font-bold text-gray-900">{summary.pendingHomeworkCount}</p>
            </div>
          </Link>
        </div>
      ) : (
        <p className="text-gray-500">Select a child above to see their summary.</p>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();

  if (user?.role === "STUDENT" || user?.role === "PARENT") {
    return <ParentDashboard />;
  }

  return <AdminDashboard isSuperAdmin={user?.role === "SUPER_ADMIN"} />;
}
