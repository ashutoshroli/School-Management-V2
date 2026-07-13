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
  const [seatPlan, setSeatPlan] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    api.get("/academics/exams").then((res) => setExams(res.data.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedExamId) {
      api.get(`/academics/exams/${selectedExamId}/schedule`).then((res) => setSchedules(res.data.data || [])).catch(() => setSchedules([]));
    } else { setSchedules([]); }
    setSelectedScheduleId("");
    setSeatPlan([]);
  }, [selectedExamId]);

  const fetchSeatPlan = async () => {
    if (!selectedScheduleId) return;
    setLoading(true);
    try {
      const res = await api.get(`/academics/exams/schedule/${selectedScheduleId}/seat-plan`);
      setSeatPlan(res.data.data || []);
    } catch { setSeatPlan([]); }
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
      setSeatPlan([]);
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to clear seat plan");
    } finally { setClearing(false); }
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
            {seatPlan.length > 0 && (
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
      ) : seatPlan.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-500">No seat plan generated yet. Click &quot;Generate&quot; to create one.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="px-4 py-3 text-center">Seat #</th>
                <th className="px-4 py-3 text-left">Student</th>
                <th className="px-4 py-3 text-left">Admission No</th>
                <th className="px-4 py-3 text-left">Room</th>
                <th className="px-4 py-3 text-center">Slip</th>
              </tr>
            </thead>
            <tbody>
              {seatPlan.map((s: any) => (
                <tr key={s.id} className="border-b">
                  <td className="px-4 py-3 text-center font-bold">{s.seatNo}</td>
                  <td className="px-4 py-3">{s.student?.user?.name || "-"}</td>
                  <td className="px-4 py-3 font-mono text-xs">{s.student?.admissionNo || "-"}</td>
                  <td className="px-4 py-3">{s.room?.name || s.room?.roomNo || "-"}</td>
                  <td className="px-4 py-3 text-center">
                    <a href={`/api/academics/exams/schedule/${selectedScheduleId}/seat-plan/student/${s.studentId}/slip`} target="_blank" rel="noreferrer" className="text-primary-600 hover:text-primary-700">
                      <Download className="h-4 w-4 inline" />
                    </a>
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
