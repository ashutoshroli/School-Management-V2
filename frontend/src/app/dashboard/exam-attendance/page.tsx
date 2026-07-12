"use client";

import { useState, useEffect } from "react";
import { ClipboardCheck, Loader2, Save } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import ErrorBanner from "@/components/ui/ErrorBanner";

const STATUS_OPTIONS = ["PRESENT", "ABSENT", "LATE", "UNFAIR_MEANS"];
const STATUS_COLORS: Record<string, string> = {
  PRESENT: "bg-green-500",
  ABSENT: "bg-red-500",
  LATE: "bg-orange-500",
  UNFAIR_MEANS: "bg-purple-500",
};

export default function ExamAttendancePage() {
  const { user } = useAuth();
  const [exams, setExams] = useState<any[]>([]);
  const [selectedExamId, setSelectedExamId] = useState("");
  const [schedule, setSchedule] = useState<any[]>([]);
  const [selectedScheduleId, setSelectedScheduleId] = useState("");
  const [rooms, setRooms] = useState<any[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Load exams
  useEffect(() => {
    api.get("/academics/exams").then((res) => setExams(res.data.data || [])).catch(() => {});
  }, []);

  // Load schedule when exam selected
  useEffect(() => {
    if (!selectedExamId) { setSchedule([]); return; }
    api.get(`/academics/exams/${selectedExamId}/schedule`)
      .then((res) => setSchedule(res.data.data || []))
      .catch(() => setSchedule([]));
  }, [selectedExamId]);

  // Load attendance when schedule selected
  useEffect(() => {
    if (!selectedScheduleId) { setRooms([]); setEdits({}); return; }
    setLoading(true);
    setError("");
    api.get(`/academics/exams/schedule/${selectedScheduleId}/attendance`)
      .then((res) => {
        const data = res.data.data?.rooms || [];
        setRooms(data);
        const existing: Record<string, string> = {};
        for (const room of data) {
          for (const s of room.students) {
            if (s.status) existing[s.studentId] = s.status;
          }
        }
        setEdits(existing);
      })
      .catch((err) => setError(err.response?.data?.message || "Failed to load"))
      .finally(() => setLoading(false));
  }, [selectedScheduleId]);

  const setStatus = (studentId: string, status: string) => {
    setEdits((prev) => ({ ...prev, [studentId]: status }));
  };

  const markAllPresent = (students: any[]) => {
    setEdits((prev) => {
      const next = { ...prev };
      for (const s of students) next[s.studentId] = "PRESENT";
      return next;
    });
  };

  const handleSave = async (roomId: string | null) => {
    const room = rooms.find((r) => r.roomId === roomId);
    if (!room) return;
    const records = room.students
      .filter((s: any) => edits[s.studentId])
      .map((s: any) => ({ studentId: s.studentId, status: edits[s.studentId] }));
    if (records.length === 0) { setMessage("Mark at least one student first"); return; }

    setSaving(true);
    setMessage("");
    try {
      await api.post(`/academics/exams/schedule/${selectedScheduleId}/attendance`, {
        ...(roomId && { roomId }),
        records,
      });
      setMessage("Attendance saved successfully!");
    } catch (err: any) {
      setMessage(err.response?.data?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const selectedExam = exams.find((e) => e.id === selectedExamId);
  const selectedSubject = schedule.find((s) => s.id === selectedScheduleId);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ClipboardCheck className="h-6 w-6 text-primary-600" /> Exam Attendance
        </h1>
        <p className="text-gray-500 mt-1">Mark attendance for each exam subject sitting</p>
      </div>

      {/* Filters */}
      <div className="card mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Select Exam</label>
            <select
              className="input-field"
              value={selectedExamId}
              onChange={(e) => { setSelectedExamId(e.target.value); setSelectedScheduleId(""); }}
            >
              <option value="">-- Choose Exam --</option>
              {exams.map((e) => (
                <option key={e.id} value={e.id}>{e.name} ({e.class?.name || ""})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Select Subject</label>
            <select
              className="input-field"
              value={selectedScheduleId}
              onChange={(e) => setSelectedScheduleId(e.target.value)}
              disabled={!selectedExamId || schedule.length === 0}
            >
              <option value="">-- Choose Subject --</option>
              {schedule.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.subject?.name || "Unknown"} - {s.examDate ? new Date(s.examDate).toLocaleDateString() : ""} ({s.startTime}-{s.endTime})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}
      {message && (
        <div className={`mb-4 text-sm rounded-lg px-3 py-2 ${message.includes("success") ? "bg-green-50 text-green-700 border border-green-200" : "bg-amber-50 text-amber-700 border border-amber-200"}`}>
          {message}
        </div>
      )}

      {/* Attendance Grid */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary-600" /></div>
      ) : selectedScheduleId && rooms.length > 0 ? (
        <div className="space-y-4">
          {rooms.map((room) => (
            <div key={room.roomId || "all"} className="card">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-800">
                  {room.roomNo ? `Room ${room.roomNo}${room.roomName ? ` (${room.roomName})` : ""}` : "All Students"}
                  <span className="text-sm text-gray-500 ml-2">({room.students.length} students)</span>
                </h3>
                <div className="flex items-center gap-3">
                  <button onClick={() => markAllPresent(room.students)} className="text-xs text-primary-600 hover:underline">Mark All Present</button>
                  <button
                    onClick={() => handleSave(room.roomId)}
                    disabled={saving}
                    className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save
                  </button>
                </div>
              </div>

              {/* Legend */}
              <div className="flex gap-4 mb-3 text-xs">
                {STATUS_OPTIONS.map((s) => (
                  <span key={s} className="flex items-center gap-1">
                    <span className={`w-3 h-3 rounded-full ${STATUS_COLORS[s]}`}></span>
                    {s.replace("_", " ")}
                  </span>
                ))}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="px-4 py-2 text-left">Roll No</th>
                      <th className="px-4 py-2 text-left">Name</th>
                      <th className="px-4 py-2 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {room.students.map((s: any) => (
                      <tr key={s.studentId} className="border-b">
                        <td className="px-4 py-2 font-mono text-xs">{s.rollNo || "-"}</td>
                        <td className="px-4 py-2 font-medium">{s.studentName}</td>
                        <td className="px-4 py-2">
                          <div className="flex justify-center gap-1">
                            {STATUS_OPTIONS.map((st) => (
                              <button
                                key={st}
                                onClick={() => setStatus(s.studentId, st)}
                                className={`w-7 h-7 rounded-full text-[10px] font-bold text-white transition-all ${STATUS_COLORS[st]} ${edits[s.studentId] === st ? "ring-2 ring-offset-1 ring-gray-800 scale-110" : "opacity-40 hover:opacity-70"}`}
                                title={st.replace("_", " ")}
                              >
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
            </div>
          ))}
        </div>
      ) : selectedScheduleId ? (
        <div className="card text-center py-8 text-gray-500">No students found for this exam sitting.</div>
      ) : (
        <div className="card text-center py-8 text-gray-400">Select an exam and subject above to mark attendance.</div>
      )}
    </div>
  );
}
