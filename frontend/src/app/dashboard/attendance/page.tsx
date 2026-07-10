"use client";

import { useState, useEffect } from "react";
import { ClipboardCheck } from "lucide-react";
import api from "@/lib/api";

const STATUS_COLORS: Record<string, string> = {
  PRESENT: "bg-green-500", ABSENT: "bg-red-500", HALF_DAY: "bg-yellow-400", LATE: "bg-orange-500",
};

export default function StudentAttendancePage() {
  const [classes, setClasses] = useState<any[]>([]);
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [sections, setSections] = useState<any[]>([]);
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { api.get("/classes").then(r => setClasses(r.data.data || [])); }, []);

  useEffect(() => {
    const cls = classes.find(c => c.id === classId);
    setSections(cls?.sections || []);
    setSectionId("");
  }, [classId, classes]);

  const fetchAttendance = async () => {
    if (!sectionId) return;
    setLoading(true);
    try {
      const res = await api.get("/academics/attendance/class", { params: { sectionId, date } });
      setStudents(res.data.data?.students || []);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { if (sectionId) fetchAttendance(); }, [sectionId, date]);

  const setStatus = (studentId: string, status: string) => {
    setStudents(prev => prev.map(s =>
      s.studentId === studentId ? { ...s, attendance: { ...s.attendance, status } } : s
    ));
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      const records = students.filter(s => s.attendance?.status).map(s => ({ studentId: s.studentId, status: s.attendance.status }));
      await api.post("/academics/attendance/mark", { sectionId, date, records });
      alert("Attendance saved!");
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2"><ClipboardCheck className="h-6 w-6 text-primary-600" /> Student Attendance</h1>
        <button onClick={saveAll} disabled={saving || !students.length} className="btn-primary">{saving ? "Saving..." : "Save All"}</button>
      </div>

      <div className="card mb-6 flex flex-wrap gap-4">
        <select className="input-field w-auto" value={classId} onChange={e => setClassId(e.target.value)}>
          <option value="">Select Class</option>
          {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="input-field w-auto" value={sectionId} onChange={e => setSectionId(e.target.value)}>
          <option value="">Section</option>
          {sections.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input type="date" className="input-field w-auto" value={date} onChange={e => setDate(e.target.value)} />
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : students.length > 0 ? (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-gray-50">
              <th className="px-4 py-3 text-left">Roll</th>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-center">Status</th>
            </tr></thead>
            <tbody>
              {students.map(s => (
                <tr key={s.studentId} className="border-b">
                  <td className="px-4 py-3 font-mono text-xs">{s.rollNo || s.admissionNo}</td>
                  <td className="px-4 py-3 font-medium">{s.name}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-center gap-1">
                      {["PRESENT","ABSENT","LATE","HALF_DAY"].map(st => (
                        <button key={st} onClick={() => setStatus(s.studentId, st)}
                          className={`w-8 h-8 rounded-full text-[10px] font-bold text-white ${STATUS_COLORS[st]} ${s.attendance?.status === st ? "ring-2 ring-offset-1 ring-gray-800 scale-110" : "opacity-30 hover:opacity-60"}`}>
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
      ) : sectionId ? (
        <p className="text-center text-gray-500 py-8">No students in this section</p>
      ) : null}
    </div>
  );
}
