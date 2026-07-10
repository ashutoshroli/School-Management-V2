"use client";

import { useState, useEffect } from "react";
import { ClipboardCheck, Calendar } from "lucide-react";
import api from "@/lib/api";
import { formatDate } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  PRESENT: "bg-green-500", ABSENT: "bg-red-500", HALF_DAY: "bg-yellow-400",
  LATE: "bg-orange-500", ON_LEAVE: "bg-blue-400",
};

export default function StaffAttendancePage() {
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [staffList, setStaffList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await api.get("/hr/attendance/date", { params: { date } });
      setStaffList(res.data.data || []);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [date]);

  const setStatus = (staffId: string, status: string) => {
    setStaffList(prev => prev.map(s =>
      s.staffId === staffId ? { ...s, attendance: { ...s.attendance, status } } : s
    ));
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      const records = staffList
        .filter(s => s.attendance?.status)
        .map(s => ({ staffId: s.staffId, status: s.attendance.status }));
      await api.post("/hr/attendance/bulk", { date, records });
      alert("Attendance saved!");
      fetchData();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6 text-primary-600" /> Staff Attendance
          </h1>
          <p className="text-gray-500 mt-1">Mark daily attendance</p>
        </div>
        <div className="flex items-center gap-3">
          <input type="date" className="input-field" value={date}
            onChange={(e) => setDate(e.target.value)} />
          <button onClick={saveAll} disabled={saving} className="btn-primary">
            {saving ? "Saving..." : "Save All"}
          </button>
        </div>
      </div>

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
    </div>
  );
}
