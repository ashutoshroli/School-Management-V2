"use client";

import { useState, useEffect } from "react";
import { LayoutGrid, Play, Trash2, Download } from "lucide-react";
import api from "@/lib/api";
import { formatDate } from "@/lib/utils";


export default function ExamSeatPlanPage() {
  const [exams, setExams] = useState<any[]>([]);
  const [selectedExamId, setSelectedExamId] = useState("");
  const [schedules, setSchedules] = useState<any[]>([]);
  const [selectedScheduleId, setSelectedScheduleId] = useState("");
  // BUG FIX: GET .../seat-plan actually responds with
  // { totalSeated, rooms: [{ roomId, roomNo, seats: [...] }] } - a
  // room-wise GROUPED structure (see examSeatPlan.controller.ts's
  // getSeatPlan/byRoom), not a flat array of seats. This page used to
  // do `setSeatPlan(res.data.data || [])` and then `seatPlan.map(...)`
  // straight over it expecting each item to be one seat - since the
  // response is an OBJECT (truthy, so the `|| []` fallback never
  // kicked in), that .map call would throw "seatPlan.map is not a
  // function" the moment any exam sitting that already had a
  // generated seat plan was selected - another render-time crash on
  // top of the formatDate one below. Now stored/rendered in the same
  // room-grouped shape as the working reference implementation on the
  // per-exam Timetable page's viewSeatPlan.
  const [seatPlanView, setSeatPlanView] = useState<{ totalSeated: number; rooms: any[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [downloadingSlipFor, setDownloadingSlipFor] = useState<string | null>(null);

  useEffect(() => {
    api.get("/academics/exams").then((res) => setExams(res.data.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedExamId) {
      api.get(`/academics/exams/${selectedExamId}/schedule`).then((res) => setSchedules(res.data.data || [])).catch(() => setSchedules([]));
    } else { setSchedules([]); }
    setSelectedScheduleId("");
    setSeatPlanView(null);
  }, [selectedExamId]);

  const fetchSeatPlan = async () => {
    if (!selectedScheduleId) return;
    setLoading(true);
    try {
      const res = await api.get(`/academics/exams/schedule/${selectedScheduleId}/seat-plan`);
      setSeatPlanView(res.data.data || { totalSeated: 0, rooms: [] });
    } catch { setSeatPlanView({ totalSeated: 0, rooms: [] }); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (selectedScheduleId) fetchSeatPlan(); }, [selectedScheduleId]);

  const handleGenerate = async () => {
    if (!selectedScheduleId) return;
    if (!confirm("Generate seat plan for this exam sitting? This will overwrite any existing plan.")) return;
    setGenerating(true);
    try {
      await api.post(`/academics/exams/schedule/${selectedScheduleId}/seat-plan`, {});
      fetchSeatPlan();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to generate seat plan");
    } finally { setGenerating(false); }
  };

  const handleClear = async () => {
    if (!selectedScheduleId) return;
    if (!confirm("Clear the entire seat plan for this sitting?")) return;
    setClearing(true);
    try {
      await api.delete(`/academics/exams/schedule/${selectedScheduleId}/seat-plan`);
      setSeatPlanView({ totalSeated: 0, rooms: [] });
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to clear seat plan");
    } finally { setClearing(false); }
  };

  // BUG FIX: this was a plain <a href="/api/...">. GET .../slip
  // requires `authenticate` (see academics.routes.ts), which only
  // reads the JWT from an Authorization header or a "token" cookie
  // (middleware/auth.ts) - this app stores the JWT in localStorage and
  // only ever attaches it via the axios `api` client's interceptor
  // (lib/api.ts), never as a cookie. A raw browser navigation sends
  // neither, so the download always 401'd, opening a tab that just
  // showed a JSON error - looking exactly like "Download does
  // nothing". Switched to the same authenticated blob-download pattern
  // already used successfully elsewhere in this app (e.g. the
  // per-exam Timetable page's downloadSeatSlip).
  const downloadSlip = async (studentId: string, studentName: string) => {
    setDownloadingSlipFor(studentId);
    try {
      const res = await api.get(`/academics/exams/schedule/${selectedScheduleId}/seat-plan/student/${studentId}/slip`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noreferrer";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch {
      alert(`Failed to download seat slip for ${studentName}`);
    } finally {
      setDownloadingSlipFor(null);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <LayoutGrid className="h-6 w-6 text-primary-600" /> Exam Seat Plan
        </h1>
        <p className="text-gray-500 mt-1">Generate room-wise seating arrangement for exams</p>
      </div>

      <div className="card mb-6">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium mb-1">Exam</label>
            <select className="input-field" value={selectedExamId} onChange={(e) => setSelectedExamId(e.target.value)}>
              <option value="">Select Exam</option>
              {exams.map((ex) => <option key={ex.id} value={ex.id}>{ex.name} ({ex.class?.name})</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium mb-1">Subject Sitting</label>
            <select className="input-field" value={selectedScheduleId} onChange={(e) => setSelectedScheduleId(e.target.value)} disabled={!schedules.length}>
              <option value="">Select Subject</option>
              {schedules.map((s: any) => <option key={s.id} value={s.id}>{s.subject?.name} - {formatDate(s.examDate)}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={handleGenerate} disabled={!selectedScheduleId || generating} className="btn-primary flex items-center gap-1.5 disabled:opacity-50">
              <Play className="h-4 w-4" /> {generating ? "Generating..." : "Generate"}
            </button>
            {(seatPlanView?.totalSeated ?? 0) > 0 && (
              <button onClick={handleClear} disabled={clearing} className="btn-secondary flex items-center gap-1.5 text-red-600 disabled:opacity-50">
                <Trash2 className="h-4 w-4" /> {clearing ? "Clearing..." : "Clear"}
              </button>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
        </div>
      ) : !selectedScheduleId ? (
        <div className="card text-center py-12">
          <p className="text-gray-500">Select an exam and subject to view or generate a seat plan.</p>
        </div>
      ) : !seatPlanView || seatPlanView.totalSeated === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-500">No seat plan generated yet. Click &quot;Generate&quot; to create one.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {seatPlanView.rooms.map((room: any) => (
            <div key={room.roomId} className="card overflow-x-auto">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                Room {room.roomNo}{room.roomName ? ` (${room.roomName})` : ""}
                <span className="text-xs text-gray-400 font-normal">
                  {room.seats.length} seated ({room.maleCount} boys / {room.femaleCount} girls{room.otherCount ? ` / ${room.otherCount} other` : ""})
                </span>
              </h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="px-4 py-3 text-center">Seat #</th>
                    <th className="px-4 py-3 text-left">Student</th>
                    <th className="px-4 py-3 text-left">Admission No</th>
                    <th className="px-4 py-3 text-left">Section</th>
                    <th className="px-4 py-3 text-center">Slip</th>
                  </tr>
                </thead>
                <tbody>
                  {room.seats.map((s: any) => (
                    <tr key={s.studentId} className="border-b">
                      <td className="px-4 py-3 text-center font-bold">{s.seatNo}</td>
                      <td className="px-4 py-3">{s.studentName || "-"}</td>
                      <td className="px-4 py-3 font-mono text-xs">{s.admissionNo || "-"}</td>
                      <td className="px-4 py-3">{s.sectionName || "-"}</td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => downloadSlip(s.studentId, s.studentName || "student")}
                          disabled={downloadingSlipFor === s.studentId}
                          className="text-primary-600 hover:text-primary-700 disabled:opacity-50"
                          title="Download seat slip"
                        >
                          <Download className="h-4 w-4 inline" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
