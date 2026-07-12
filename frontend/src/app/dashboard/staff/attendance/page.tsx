"use client";

import { useState, useEffect } from "react";
import { ClipboardCheck, Calendar, LogIn, LogOut, FileDown, BarChart3 } from "lucide-react";
import api from "@/lib/api";
import { todayLocalDateInput } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";

const STATUS_COLORS: Record<string, string> = {
  PRESENT: "bg-green-500", ABSENT: "bg-red-500", HALF_DAY: "bg-yellow-400",
  LATE: "bg-orange-500", ON_LEAVE: "bg-blue-400",
};

// Self check-in/out widget - any staff member (not just admins) can
// punch their own attendance via the new selfMarkAttendance endpoint,
// which previously had no self-service path at all (only an admin
// could mark attendance, for anyone).
function SelfCheckInWidget() {
  const [status, setStatus] = useState<"idle" | "checking" | "done">("idle");
  const [lastAction, setLastAction] = useState<{ action: string; time: string } | null>(null);
  const [error, setError] = useState("");

  const handleCheckInOut = async () => {
    setStatus("checking");
    setError("");
    try {
      const res = await api.post("/hr/attendance/self");
      setLastAction({ action: res.data.data.action, time: new Date().toLocaleTimeString() });
      setStatus("done");
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to record attendance");
      setStatus("idle");
    }
  };

  return (
    <div className="card mb-6 bg-primary-50 border-primary-100">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-semibold text-primary-800 flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4" /> My Attendance
          </h3>
          {lastAction ? (
            <p className="text-sm text-primary-700 mt-1">
              Checked {lastAction.action === "IN" ? "in" : "out"} at {lastAction.time}
            </p>
          ) : (
            <p className="text-sm text-primary-600 mt-1">Punch your own attendance for today</p>
          )}
          {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
        </div>
        <button onClick={handleCheckInOut} disabled={status === "checking"} className="btn-primary flex items-center gap-2 disabled:opacity-50">
          {lastAction?.action === "IN" ? <LogOut className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
          {status === "checking" ? "Recording..." : lastAction?.action === "IN" ? "Check Out" : "Check In / Out"}
        </button>
      </div>
    </div>
  );
}

export default function StaffAttendancePage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "SUPER_ADMIN" || user?.role === "BRANCH_ADMIN";

  // BUG FIX: was `new Date().toISOString().split("T")[0]`, which
  // converts to UTC first and can default the date picker to the wrong
  // calendar day for users outside a UTC+0-ish timezone (see
  // todayLocalDateInput's doc comment in lib/utils.ts).
  const [date, setDate] = useState(todayLocalDateInput());
  const [staffList, setStaffList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Monthly report tab (admin only) - branch-wide present/absent/late/
  // leave totals + attendance % per staff member, with CSV export,
  // using the new getStaffAttendanceReport/exportStaffAttendanceReportCsv
  // endpoints.
  const [tab, setTab] = useState<"mark" | "report">("mark");
  const now = new Date();
  const [reportMonth, setReportMonth] = useState(String(now.getMonth() + 1));
  const [reportYear, setReportYear] = useState(String(now.getFullYear()));
  const [reportRows, setReportRows] = useState<any[]>([]);
  const [reportLoading, setReportLoading] = useState(false);

  const fetchReport = async () => {
    setReportLoading(true);
    try {
      const res = await api.get("/hr/attendance/report", { params: { month: reportMonth, year: reportYear } });
      setReportRows(res.data.data.rows || []);
    } catch {
      setReportRows([]);
    } finally {
      setReportLoading(false);
    }
  };

  useEffect(() => { if (tab === "report") fetchReport(); }, [tab, reportMonth, reportYear]);

  // CSV-streaming endpoint needs the Authorization header attached,
  // which a plain <a href>/window.open(url) navigation can't do (same
  // reasoning as lib/pdf.ts's openPdfInNewTab) - fetch as a blob
  // through the authenticated axios client instead, then trigger a
  // save via a temporary anchor element.
  const downloadReportCsv = async () => {
    try {
      const res = await api.get("/hr/attendance/report/csv", { params: { month: reportMonth, year: reportYear }, responseType: "blob" });
      const blobUrl = URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `staff-attendance-${reportYear}-${reportMonth.padStart(2, "0")}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5_000);
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to download report");
    }
  };

  const fetchData = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/hr/attendance/date", { params: { date } });
      setStaffList(res.data.data || []);
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to load staff attendance for this date");
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [date]);

  const setStatus = (staffId: string, status: string) => {
    setStaffList(prev => prev.map(s =>
      s.staffId === staffId ? { ...s, attendance: { ...s.attendance, status } } : s
    ));
  };

  const saveAll = async () => {
    setSaving(true);
    setError("");
    try {
      const records = staffList
        .filter(s => s.attendance?.status)
        .map(s => ({ staffId: s.staffId, status: s.attendance.status }));
      const res = await api.post("/hr/attendance/bulk", { date, records });
      // Refetch so the table reflects exactly what's now saved, rather
      // than trusting the optimistic client-side state.
      await fetchData();
      alert(res.data.message || "Attendance saved!");
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to save attendance. Please try again.");
    }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ClipboardCheck className="h-6 w-6 text-primary-600" /> Staff Attendance
        </h1>
        <p className="text-gray-500 mt-1">Mark daily attendance{isAdmin ? " or view the monthly report" : ""}</p>
      </div>

      <SelfCheckInWidget />

      {isAdmin && (
        <div className="flex gap-2 mb-6 border-b">
          <button onClick={() => setTab("mark")} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 ${tab === "mark" ? "border-primary-600 text-primary-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            <Calendar className="h-4 w-4" /> Mark Attendance
          </button>
          <button onClick={() => setTab("report")} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 ${tab === "report" ? "border-primary-600 text-primary-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            <BarChart3 className="h-4 w-4" /> Monthly Report
          </button>
        </div>
      )}

      {tab === "mark" ? (
        <>
          <div className="flex items-center justify-end mb-4 gap-3">
            <input type="date" className="input-field" value={date}
              onChange={(e) => setDate(e.target.value)} />
            <button onClick={saveAll} disabled={saving} className="btn-primary">
              {saving ? "Saving..." : "Save All"}
            </button>
          </div>

          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>
          )}

          {/* Legend */}
          <div className="flex gap-4 mb-4 text-xs">
            {Object.entries(STATUS_COLORS).map(([s, c]) => (
              <span key={s} className="flex items-center gap-1">
                <span className={`w-3 h-3 rounded-full ${c}`}></span> {s.replace("_", " ")}
              </span>
            ))}
          </div>

          {loading ? (
            <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b bg-gray-50">
                  <th className="px-4 py-3 text-left">Emp ID</th>
                  <th className="px-4 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-left">Designation</th>
                  <th className="px-4 py-3 text-center">Status</th>
                </tr></thead>
                <tbody>
                  {staffList.map((s) => (
                    <tr key={s.staffId} className="border-b">
                      <td className="px-4 py-3 font-mono text-xs">{s.employeeId}</td>
                      <td className="px-4 py-3 font-medium">{s.name}</td>
                      <td className="px-4 py-3 text-gray-500">{s.designation}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-center gap-1">
                          {["PRESENT", "ABSENT", "HALF_DAY", "LATE", "ON_LEAVE"].map(st => (
                            <button key={st} onClick={() => setStatus(s.staffId, st)}
                              className={`w-7 h-7 rounded-full text-[10px] font-bold text-white transition-all ${STATUS_COLORS[st]} ${s.attendance?.status === st ? "ring-2 ring-offset-1 ring-gray-800 scale-110" : "opacity-40 hover:opacity-70"}`}
                              title={st.replace("_", " ")}>
                              {st[0]}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <select className="input-field w-auto" value={reportMonth} onChange={(e) => setReportMonth(e.target.value)}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={String(m)}>{new Date(2000, m - 1).toLocaleString("default", { month: "long" })}</option>
                ))}
              </select>
              <select className="input-field w-auto" value={reportYear} onChange={(e) => setReportYear(e.target.value)}>
                {[now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2].map((y) => <option key={y} value={String(y)}>{y}</option>)}
              </select>
            </div>
            <button onClick={downloadReportCsv} className="btn-secondary flex items-center gap-2">
              <FileDown className="h-4 w-4" /> Export CSV
            </button>
          </div>

          {reportLoading ? (
            <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b bg-gray-50">
                  <th className="px-4 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-left">Designation</th>
                  <th className="px-4 py-3 text-center">Present</th>
                  <th className="px-4 py-3 text-center">Absent</th>
                  <th className="px-4 py-3 text-center">Half Day</th>
                  <th className="px-4 py-3 text-center">Late</th>
                  <th className="px-4 py-3 text-center">On Leave</th>
                  <th className="px-4 py-3 text-center">Attendance %</th>
                </tr></thead>
                <tbody>
                  {reportRows.map((r: any) => (
                    <tr key={r.employeeId} className="border-b">
                      <td className="px-4 py-3 font-medium">{r.name}</td>
                      <td className="px-4 py-3 text-gray-500">{r.designation}</td>
                      <td className="px-4 py-3 text-center text-green-700">{r.present}</td>
                      <td className="px-4 py-3 text-center text-red-600">{r.absent}</td>
                      <td className="px-4 py-3 text-center text-yellow-600">{r.halfDay}</td>
                      <td className="px-4 py-3 text-center text-orange-600">{r.late}</td>
                      <td className="px-4 py-3 text-center text-blue-600">{r.onLeave}</td>
                      <td className={`px-4 py-3 text-center font-medium ${r.attendancePercent < 75 ? "text-red-600" : "text-gray-900"}`}>{r.attendancePercent}%</td>
                    </tr>
                  ))}
                  {reportRows.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">No data for this month</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
