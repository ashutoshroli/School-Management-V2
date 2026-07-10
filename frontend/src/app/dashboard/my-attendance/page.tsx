"use client";

import { useEffect, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import api from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { useChildren } from "@/hooks/useChildren";
import ChildSwitcher from "@/components/parent/ChildSwitcher";
import ErrorBanner from "@/components/ui/ErrorBanner";

const STATUS_COLORS: Record<string, string> = {
  PRESENT: "bg-green-100 text-green-700",
  ABSENT: "bg-red-100 text-red-700",
  HALF_DAY: "bg-yellow-100 text-yellow-700",
  LATE: "bg-orange-100 text-orange-700",
};

export default function MyAttendancePage() {
  const { children, selectedChildId, fetchChildren } = useChildren();
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<{ records: any[]; summary: any } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchChildren();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAttendance = async () => {
    if (!selectedChildId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/academics/attendance/student/${selectedChildId}`, { params: { month, year } });
      setData(res.data.data);
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to load attendance");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedChildId) loadAttendance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChildId, month, year]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6 text-primary-600" /> My Attendance
          </h1>
          <p className="text-gray-500 mt-1">Monthly attendance record</p>
        </div>
        <ChildSwitcher />
      </div>

      {error && <ErrorBanner message={error} onRetry={loadAttendance} />}

      <div className="card mb-6 flex flex-wrap gap-4">
        <select className="input-field w-auto" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {new Date(2000, m - 1).toLocaleString("en", { month: "long" })}
            </option>
          ))}
        </select>
        <select className="input-field w-auto" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[year - 1, year, year + 1].map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
        </div>
      ) : data ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="card text-center">
              <p className="text-2xl font-bold text-primary-600">{data.summary.percentage}%</p>
              <p className="text-xs text-gray-500 mt-1">Attendance</p>
            </div>
            <div className="card text-center">
              <p className="text-2xl font-bold text-green-600">{data.summary.present}</p>
              <p className="text-xs text-gray-500 mt-1">Present</p>
            </div>
            <div className="card text-center">
              <p className="text-2xl font-bold text-red-600">{data.summary.absent}</p>
              <p className="text-xs text-gray-500 mt-1">Absent</p>
            </div>
            <div className="card text-center">
              <p className="text-2xl font-bold text-orange-600">{data.summary.late}</p>
              <p className="text-xs text-gray-500 mt-1">Late</p>
            </div>
            <div className="card text-center">
              <p className="text-2xl font-bold text-yellow-600">{data.summary.halfDay}</p>
              <p className="text-xs text-gray-500 mt-1">Half Day</p>
            </div>
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold mb-4">Daily Record</h3>
            {data.records.length === 0 ? (
              <p className="text-gray-400 text-sm">No attendance records for this month yet</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {data.records.map((r) => (
                  <div key={r.id} className={`px-3 py-2 rounded-lg text-sm flex justify-between ${STATUS_COLORS[r.status] || "bg-gray-100"}`}>
                    <span>{formatDate(r.date)}</span>
                    <span className="font-medium">{r.status.replace("_", " ")}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
