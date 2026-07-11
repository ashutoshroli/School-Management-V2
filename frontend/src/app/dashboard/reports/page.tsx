"use client";

import { useState, useEffect } from "react";
import { BarChart3, Users, GraduationCap, IndianRupee, ClipboardCheck, Building2, AlertTriangle, Download } from "lucide-react";
import api from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

export default function ReportsPage() {
  const [tab, setTab] = useState<"dashboard" | "attendance" | "academic" | "hr" | "branches" | "attendanceDefaulters">("dashboard");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [threshold, setThreshold] = useState(75);

  const fetchData = async () => {
    setLoading(true);
    try {
      let res;
      if (tab === "dashboard") res = await api.get("/reports/dashboard");
      else if (tab === "attendance") res = await api.get("/reports/attendance-analytics");
      else if (tab === "attendanceDefaulters") res = await api.get("/reports/attendance-defaulters", { params: { threshold } });
      else if (tab === "academic") res = await api.get("/reports/academic-analytics");
      else if (tab === "hr") res = await api.get("/reports/hr-analytics");
      else res = await api.get("/reports/multi-branch");
      setData(res.data.data);
    } catch {} finally { setLoading(false); }
  };
  useEffect(() => { fetchData(); }, [tab, threshold]);

  // Switching tabs updates `tab` synchronously, but the new tab's data
  // only arrives after the async fetchData() call above resolves.
  // Without this, React renders the newly-selected tab's JSX against
  // the PREVIOUS tab's `data` shape for one frame (e.g. Overview's
  // plain object still in state while the Attendance tab's code runs
  // `data.map(...)` on it) - that shape mismatch throws and crashes
  // the whole page ("Application error: a client-side exception").
  // Clearing `data` and forcing `loading` true the instant a tab is
  // clicked guarantees the loading spinner renders instead of stale
  // data on every tab switch.
  const handleTabClick = (key: typeof tab) => {
    setData(null);
    setLoading(true);
    setTab(key);
  };

  const downloadAttendanceDefaultersCsv = async () => {
    // The backend's `authenticate` middleware only reads the JWT from
    // the Authorization header (or a cookie) - not a query param - so
    // a plain <a href>/window.open navigation can't authenticate.
    // Fetching as a blob via the authenticated axios client and
    // triggering a client-side download works around that.
    const res = await api.get("/reports/attendance-defaulters/export", {
      params: { threshold },
      responseType: "blob",
    });
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const link = document.createElement("a");
    link.href = url;
    link.download = `attendance-defaulters-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  const tabs = [
    { key: "dashboard", label: "Overview", icon: BarChart3 },
    { key: "attendance", label: "Attendance", icon: ClipboardCheck },
    { key: "attendanceDefaulters", label: "At-Risk Students", icon: AlertTriangle },
    { key: "academic", label: "Academic", icon: GraduationCap },
    { key: "hr", label: "HR/Payroll", icon: Users },
    { key: "branches", label: "Multi-Branch", icon: Building2 },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <BarChart3 className="h-6 w-6 text-primary-600" /> Reports & Analytics
      </h1>

      <div className="flex flex-wrap gap-2 mb-6">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => handleTabClick(t.key as any)}
              className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 ${tab === t.key ? "bg-primary-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>
              <Icon className="h-4 w-4" /> {t.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : !data ? <p className="text-gray-500">No data</p> : (
        <>
          {/* DASHBOARD TAB */}
          {tab === "dashboard" && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Students", value: data.totalStudents, icon: GraduationCap, color: "text-blue-600 bg-blue-100" },
                { label: "Staff", value: data.totalStaff, icon: Users, color: "text-green-600 bg-green-100" },
                { label: "Fee This Month", value: formatCurrency(data.feeCollectedMonth), icon: IndianRupee, color: "text-purple-600 bg-purple-100" },
                { label: "Fee Pending", value: formatCurrency(data.feePending), icon: IndianRupee, color: "text-red-600 bg-red-100" },
                { label: "Attendance Today", value: `${data.attendanceToday}%`, icon: ClipboardCheck, color: "text-orange-600 bg-orange-100" },
                { label: "Staff on Leave", value: data.staffOnLeave, icon: Users, color: "text-yellow-600 bg-yellow-100" },
                { label: "Classes", value: data.totalClasses, icon: Building2, color: "text-indigo-600 bg-indigo-100" },
              ].map(s => {
                const Icon = s.icon;
                return (
                  <div key={s.label} className="card flex items-center gap-3">
                    <div className={`p-3 rounded-xl ${s.color}`}><Icon className="h-5 w-5" /></div>
                    <div><p className="text-xs text-gray-500">{s.label}</p><p className="text-lg font-bold">{s.value}</p></div>
                  </div>
                );
              })}
            </div>
          )}


          {/* ATTENDANCE TAB */}
          {tab === "attendance" && (
            <div className="card overflow-x-auto">
              <h3 className="font-semibold mb-4">Class-wise Attendance (This Month)</h3>
              <table className="w-full text-sm"><thead><tr className="border-b bg-gray-50">
                <th className="px-4 py-3 text-left">Class</th><th className="px-4 py-3 text-center">Students</th>
                <th className="px-4 py-3 text-center">Records</th><th className="px-4 py-3 text-center">Present</th>
                <th className="px-4 py-3 text-center">Attendance %</th>
              </tr></thead><tbody>
                {data.map((r: any) => (
                  <tr key={r.className} className="border-b"><td className="px-4 py-3 font-medium">{r.className}</td>
                    <td className="px-4 py-3 text-center">{r.students}</td><td className="px-4 py-3 text-center">{r.totalRecords}</td>
                    <td className="px-4 py-3 text-center">{r.presentRecords}</td>
                    <td className="px-4 py-3 text-center"><div className="flex items-center justify-center gap-2">
                      <div className="w-24 h-2 bg-gray-200 rounded-full"><div className={`h-2 rounded-full ${r.percentage >= 75 ? "bg-green-500" : r.percentage >= 50 ? "bg-yellow-400" : "bg-red-500"}`} style={{width: `${r.percentage}%`}} /></div>
                      <span className="font-medium">{r.percentage}%</span>
                    </div></td></tr>
                ))}
              </tbody></table>
            </div>
          )}

          {/* AT-RISK STUDENTS (ATTENDANCE DEFAULTERS) TAB */}
          {tab === "attendanceDefaulters" && (
            <div>
              <div className="card mb-4 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                  <span className="font-medium text-amber-700">
                    {data.count ?? data.students?.length ?? 0} student(s) below {threshold}% attendance
                    {data.workingDays ? ` (out of ${data.workingDays} working day(s) this month)` : ""}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-sm text-gray-600 flex items-center gap-2">
                    Threshold:
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={threshold}
                      onChange={(e) => setThreshold(Number(e.target.value))}
                      className="input-field w-20 py-1"
                    />%
                  </label>
                  <button
                    onClick={downloadAttendanceDefaultersCsv}
                    disabled={!data.students?.length}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                  >
                    <Download className="h-4 w-4" /> Export CSV
                  </button>
                </div>
              </div>
              <div className="card overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b bg-gray-50">
                    <th className="px-4 py-3 text-left">Student</th><th className="px-4 py-3 text-left">Class</th>
                    <th className="px-4 py-3 text-center">Present / Working Days</th><th className="px-4 py-3 text-center">Attendance %</th>
                  </tr></thead>
                  <tbody>
                    {(data.students || []).map((s: any) => (
                      <tr key={s.studentId} className="border-b">
                        <td className="px-4 py-3"><p className="font-medium">{s.name}</p><p className="text-xs text-gray-500">{s.phone}</p></td>
                        <td className="px-4 py-3">{s.className}-{s.sectionName}</td>
                        <td className="px-4 py-3 text-center">{s.presentDays} / {s.workingDays}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.percentage < 50 ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                            {s.percentage}%
                          </span>
                        </td>
                      </tr>
                    ))}
                    {(!data.students || data.students.length === 0) && (
                      <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">No students below this threshold</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ACADEMIC TAB */}
          {tab === "academic" && (
            <div className="card overflow-x-auto">
              <h3 className="font-semibold mb-4">Class-wise Academic Performance</h3>
              <table className="w-full text-sm"><thead><tr className="border-b bg-gray-50">
                <th className="px-4 py-3 text-left">Class</th><th className="px-4 py-3 text-center">Students</th>
                <th className="px-4 py-3 text-center">Avg %</th><th className="px-4 py-3 text-center">Pass %</th>
              </tr></thead><tbody>
                {data.map((r: any) => (
                  <tr key={r.className} className="border-b"><td className="px-4 py-3 font-medium">{r.className}</td>
                    <td className="px-4 py-3 text-center">{r.totalStudents}</td>
                    <td className="px-4 py-3 text-center font-bold text-primary-700">{r.avgPercent}%</td>
                    <td className="px-4 py-3 text-center"><span className={`px-2 py-0.5 rounded-full text-xs ${r.passPercent >= 80 ? "bg-green-100 text-green-700" : r.passPercent >= 50 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"}`}>{r.passPercent}%</span></td>
                  </tr>
                ))}
              </tbody></table>
            </div>
          )}

          {/* HR TAB */}
          {tab === "hr" && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="card text-center"><p className="text-xs text-gray-500">Salary Cost</p><p className="text-xl font-bold text-green-700">{formatCurrency(data.totalSalaryCost)}</p></div>
              <div className="card text-center"><p className="text-xs text-gray-500">PF Total</p><p className="text-xl font-bold text-blue-700">{formatCurrency(data.totalPF)}</p></div>
              <div className="card text-center"><p className="text-xs text-gray-500">ESI Total</p><p className="text-xl font-bold text-purple-700">{formatCurrency(data.totalESI)}</p></div>
              <div className="card text-center"><p className="text-xs text-gray-500">TDS Total</p><p className="text-xl font-bold text-red-600">{formatCurrency(data.totalTDS)}</p></div>
              <div className="card text-center"><p className="text-xs text-gray-500">Staff Count</p><p className="text-xl font-bold">{data.totalStaff}</p></div>
              <div className="card text-center"><p className="text-xs text-gray-500">Attendance %</p><p className="text-xl font-bold">{data.staffAttendancePercent}%</p></div>
              <div className="card text-center"><p className="text-xs text-gray-500">Leaves (month)</p><p className="text-xl font-bold">{data.leavesApproved}</p></div>
              <div className="card text-center"><p className="text-xs text-gray-500">Payslips</p><p className="text-xl font-bold">{data.payslipCount}</p></div>
            </div>
          )}

          {/* MULTI-BRANCH TAB */}
          {tab === "branches" && (
            <div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="card text-center"><p className="text-xs text-gray-500">Total Students</p><p className="text-xl font-bold">{data.grandTotal.totalStudents}</p></div>
                <div className="card text-center"><p className="text-xs text-gray-500">Total Staff</p><p className="text-xl font-bold">{data.grandTotal.totalStaff}</p></div>
                <div className="card text-center"><p className="text-xs text-gray-500">Total Collected</p><p className="text-xl font-bold text-green-700">{formatCurrency(data.grandTotal.totalCollected)}</p></div>
                <div className="card text-center"><p className="text-xs text-gray-500">Total Pending</p><p className="text-xl font-bold text-red-600">{formatCurrency(data.grandTotal.totalPending)}</p></div>
              </div>
              <div className="card overflow-x-auto">
                <table className="w-full text-sm"><thead><tr className="border-b bg-gray-50">
                  <th className="px-4 py-3 text-left">Branch</th><th className="px-4 py-3 text-left">City</th>
                  <th className="px-4 py-3 text-center">Students</th><th className="px-4 py-3 text-center">Staff</th>
                  <th className="px-4 py-3 text-right">Collected</th><th className="px-4 py-3 text-right">Pending</th>
                </tr></thead><tbody>
                  {data.branches.map((b: any) => (
                    <tr key={b.branchId} className="border-b"><td className="px-4 py-3 font-medium">{b.branchName}</td>
                      <td className="px-4 py-3 text-gray-500">{b.city}</td>
                      <td className="px-4 py-3 text-center">{b.students}</td><td className="px-4 py-3 text-center">{b.staff}</td>
                      <td className="px-4 py-3 text-right text-green-700">{formatCurrency(b.totalFeeCollected)}</td>
                      <td className="px-4 py-3 text-right text-red-600">{formatCurrency(b.feePending)}</td></tr>
                  ))}
                </tbody></table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
