"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CalendarClock, Save, Plus, Trash2, Upload, FileText, Loader2 } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import ErrorBanner from "@/components/ui/ErrorBanner";
import { formatDate } from "@/lib/utils";

interface ScheduleRow {
  id?: string;
  subjectId: string;
  examDate: string;
  startTime: string;
  endTime: string;
  durationMinutes: string;
  maxMarks: string;
  roomId: string;
}

const EMPTY_ROW: ScheduleRow = { subjectId: "", examDate: "", startTime: "", endTime: "", durationMinutes: "", maxMarks: "", roomId: "" };

/**
 * Exam Timetable ("date sheet") editor - per-subject date/time/duration/
 * room/maxMarks, saved as a whole list at once via PUT
 * /academics/exams/schedule (same "edit the whole list, then Save"
 * convention as the Period Schedule settings card). Also hosts the
 * question-paper upload widget per scheduled subject, since both are
 * naturally organized around "one row per exam subject sitting".
 */
export default function ExamSchedulePage() {
  const params = useParams();
  const router = useRouter();
  const examId = params.id as string;
  const { user } = useAuth();
  const isAdmin = user?.role === "SUPER_ADMIN" || user?.role === "BRANCH_ADMIN";

  const [exam, setExam] = useState<any>(null);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Question papers, keyed by examScheduleId - only meaningful for
  // ALREADY-SAVED rows (row.id set), since a paper is uploaded against
  // one specific schedule entry.
  const [papersByScheduleId, setPapersByScheduleId] = useState<Record<string, any[]>>({});
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);

  const flattenRooms = (buildings: any[]) =>
    buildings.flatMap((b: any) =>
      (b.floors || []).flatMap((f: any) =>
        (f.rooms || []).map((r: any) => ({ id: r.id, label: `${b.name} / ${f.name || `Floor ${f.floorNo}`} / ${r.roomNo}${r.name ? ` (${r.name})` : ""}` }))
      )
    );

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const examsRes = await api.get("/academics/exams");
      const found = (examsRes.data.data || []).find((e: any) => e.id === examId);
      if (!found) { setError("Exam not found"); return; }
      setExam(found);

      const [subjectsRes, scheduleRes, roomsRes] = await Promise.all([
        api.get(`/classes/${found.classId}/subjects`),
        api.get(`/academics/exams/${examId}/schedule`),
        api.get("/facilities/school-buildings").catch(() => ({ data: { data: [] } })),
      ]);
      setSubjects((subjectsRes.data.data || []).map((cs: any) => cs.subject));
      setRooms(flattenRooms(roomsRes.data.data || []));

      const schedule = scheduleRes.data.data || [];
      if (schedule.length > 0) {
        setRows(
          schedule.map((s: any) => ({
            id: s.id,
            subjectId: s.subjectId,
            examDate: s.examDate ? new Date(s.examDate).toISOString().slice(0, 10) : "",
            startTime: s.startTime,
            endTime: s.endTime,
            durationMinutes: String(s.durationMinutes),
            maxMarks: String(s.maxMarks),
            roomId: s.roomId || "",
          }))
        );
        // Load question papers for every already-saved row.
        const papersEntries = await Promise.all(
          schedule.map(async (s: any) => {
            try {
              const r = await api.get("/academics/exams/question-papers", { params: { examScheduleId: s.id } });
              return [s.id, r.data.data || []] as const;
            } catch {
              return [s.id, []] as const;
            }
          })
        );
        setPapersByScheduleId(Object.fromEntries(papersEntries));
      } else {
        setRows([{ ...EMPTY_ROW }]);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to load exam schedule");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [examId]);

  const addRow = () => setRows([...rows, { ...EMPTY_ROW }]);
  const removeRow = (index: number) => setRows(rows.filter((_, i) => i !== index));
  const updateRow = (index: number, field: keyof ScheduleRow, value: string) => {
    setRows(rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  };

  const handleSave = async () => {
    setMessage(null);
    const cleaned = rows.filter((r) => r.subjectId);
    if (cleaned.length === 0) {
      setMessage({ type: "error", text: "Add at least one subject before saving" });
      return;
    }
    for (const r of cleaned) {
      if (!r.examDate || !r.startTime || !r.endTime || !r.durationMinutes || !r.maxMarks) {
        setMessage({ type: "error", text: "Every subject needs a date, start/end time, duration, and max marks" });
        return;
      }
    }
    setSaving(true);
    try {
      await api.put("/academics/exams/schedule", {
        examId,
        schedule: cleaned.map((r) => ({
          subjectId: r.subjectId,
          examDate: r.examDate,
          startTime: r.startTime,
          endTime: r.endTime,
          durationMinutes: parseInt(r.durationMinutes),
          maxMarks: parseFloat(r.maxMarks),
          roomId: r.roomId || undefined,
        })),
      });
      setMessage({ type: "success", text: "Exam schedule saved" });
      load();
    } catch (err: any) {
      setMessage({ type: "error", text: err.response?.data?.message || "Failed to save exam schedule" });
    } finally {
      setSaving(false);
    }
  };

  const handleUploadPaper = async (examScheduleId: string, file: File) => {
    setUploadingFor(examScheduleId);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("examScheduleId", examScheduleId);
      const res = await api.post("/academics/exams/question-papers", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setPapersByScheduleId((prev) => ({ ...prev, [examScheduleId]: [res.data.data, ...(prev[examScheduleId] || [])] }));
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to upload question paper");
    } finally {
      setUploadingFor(null);
    }
  };

  const handleDeletePaper = async (examScheduleId: string, paperId: string) => {
    if (!confirm("Delete this question paper?")) return;
    try {
      await api.delete(`/academics/exams/question-papers/${paperId}`);
      setPapersByScheduleId((prev) => ({ ...prev, [examScheduleId]: (prev[examScheduleId] || []).filter((p) => p.id !== paperId) }));
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to delete question paper");
    }
  };

  const subjectName = (id: string) => subjects.find((s) => s.id === id)?.name || "-";

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="p-2 rounded-lg hover:bg-gray-100">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <CalendarClock className="h-6 w-6 text-primary-600" /> Exam Timetable
          </h1>
          <p className="text-gray-500 mt-1">{exam ? `${exam.name} - ${exam.class?.name}` : "Loading exam..."}</p>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
        </div>
      ) : exam ? (
        <>
          {message && (
            <div className={`mb-4 text-sm rounded-lg px-3 py-2 ${message.type === "success" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
              {message.text}
            </div>
          )}

          {isAdmin && (
            <div className="card overflow-x-auto mb-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="px-3 py-2 text-left">Subject</th>
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-left">Start</th>
                    <th className="px-3 py-2 text-left">End</th>
                    <th className="px-3 py-2 text-left">Duration (min)</th>
                    <th className="px-3 py-2 text-left">Max Marks</th>
                    <th className="px-3 py-2 text-left">Room</th>
                    <th className="px-3 py-2 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b">
                      <td className="px-3 py-2">
                        <select className="input-field" value={r.subjectId} onChange={(e) => updateRow(i, "subjectId", e.target.value)}>
                          <option value="">Select</option>
                          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2"><input type="date" className="input-field" value={r.examDate} onChange={(e) => updateRow(i, "examDate", e.target.value)} /></td>
                      <td className="px-3 py-2"><input type="time" className="input-field" value={r.startTime} onChange={(e) => updateRow(i, "startTime", e.target.value)} /></td>
                      <td className="px-3 py-2"><input type="time" className="input-field" value={r.endTime} onChange={(e) => updateRow(i, "endTime", e.target.value)} /></td>
                      <td className="px-3 py-2"><input type="number" min={1} className="input-field w-24" value={r.durationMinutes} onChange={(e) => updateRow(i, "durationMinutes", e.target.value)} /></td>
                      <td className="px-3 py-2"><input type="number" min={1} className="input-field w-20" value={r.maxMarks} onChange={(e) => updateRow(i, "maxMarks", e.target.value)} /></td>
                      <td className="px-3 py-2">
                        <select className="input-field" value={r.roomId} onChange={(e) => updateRow(i, "roomId", e.target.value)}>
                          <option value="">None</option>
                          {rooms.map((rm) => <option key={rm.id} value={rm.id}>{rm.label}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button onClick={() => removeRow(i)} className="text-red-500 hover:text-red-700"><Trash2 className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex justify-between items-center px-3 py-3 border-t">
                <button onClick={addRow} className="btn-secondary flex items-center gap-2 text-sm"><Plus className="h-4 w-4" /> Add Subject</button>
                <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2 text-sm disabled:opacity-60">
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />} {saving ? "Saving..." : "Save Schedule"}
                </button>
              </div>
            </div>
          )}

          <div className="card">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2"><FileText className="h-5 w-5 text-indigo-600" /> Question Papers</h3>
            <p className="text-sm text-gray-500 mb-4">
              Upload the question paper (PDF or DOCX) for each scheduled subject. You can only upload for a subject you
              are assigned to teach for this class.
            </p>
            {rows.filter((r) => r.id).length === 0 ? (
              <p className="text-sm text-gray-400">Save the schedule above first, then question papers can be uploaded per subject.</p>
            ) : (
              <div className="space-y-3">
                {rows.filter((r) => r.id).map((r) => (
                  <div key={r.id} className="border rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <span className="font-medium">{subjectName(r.subjectId)}</span>
                        <span className="text-xs text-gray-500 ml-2">{r.examDate ? formatDate(r.examDate) : ""} {r.startTime}-{r.endTime}</span>
                      </div>
                      <label className="btn-secondary flex items-center gap-2 text-xs cursor-pointer disabled:opacity-60">
                        {uploadingFor === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                        Upload Paper
                        <input
                          type="file"
                          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                          className="hidden"
                          disabled={uploadingFor === r.id}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file && r.id) handleUploadPaper(r.id, file);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    </div>
                    {(papersByScheduleId[r.id!] || []).length > 0 ? (
                      <ul className="space-y-1">
                        {(papersByScheduleId[r.id!] || []).map((p: any) => (
                          <li key={p.id} className="flex items-center justify-between text-xs bg-gray-50 rounded px-2 py-1.5">
                            <a href={p.fileUrl} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline">{p.fileName}</a>
                            <button onClick={() => handleDeletePaper(r.id!, p.id)} className="text-red-500 hover:text-red-700"><Trash2 className="h-3.5 w-3.5" /></button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-gray-400">No paper uploaded yet.</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
