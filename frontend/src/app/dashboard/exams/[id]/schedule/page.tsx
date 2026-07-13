"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CalendarClock, Save, Plus, Trash2, Upload, FileText, Loader2, Armchair, X, Users, ClipboardCheck, Contact, Download, CheckCircle2, AlertTriangle } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import ErrorBanner from "@/components/ui/ErrorBanner";
import Modal from "@/components/ui/Modal";
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

  // Seat Plan generator/viewer - per scheduled subject sitting.
  const [sections, setSections] = useState<any[]>([]);
  const [seatPlanModalFor, setSeatPlanModalFor] = useState<string | null>(null);
  const [seatPlanForm, setSeatPlanForm] = useState({
    roomIds: [] as string[],
    arrangement: "ROLL_NO_ORDER" as "ROLL_NO_ORDER" | "ALTERNATE_GENDER",
    sectionIds: [] as string[],
    gender: "",
    rollNoFrom: "",
    rollNoTo: "",
  });
  const [generatingSeatPlan, setGeneratingSeatPlan] = useState(false);
  const [seatPlanError, setSeatPlanError] = useState("");
  const [viewingSeatPlanFor, setViewingSeatPlanFor] = useState<string | null>(null);
  const [seatPlanView, setSeatPlanView] = useState<any>(null);
  const [loadingSeatPlanView, setLoadingSeatPlanView] = useState(false);

  // Exam Attendance - per scheduled subject sitting, room-wise if a
  // seat plan exists, otherwise the whole class roster unroomed.
  const [markingAttendanceFor, setMarkingAttendanceFor] = useState<string | null>(null);
  const [attendanceRooms, setAttendanceRooms] = useState<any[]>([]);
  const [attendanceEdits, setAttendanceEdits] = useState<Record<string, string>>({}); // studentId -> status
  const [loadingAttendance, setLoadingAttendance] = useState(false);
  const [savingAttendance, setSavingAttendance] = useState(false);
  const [attendanceMessage, setAttendanceMessage] = useState("");

  // Admit Cards - eligibility rule checklist (75% attendance + fees
  // cleared till month) + single/bulk generation.
  const [admitCards, setAdmitCards] = useState<any[]>([]);
  const [loadingAdmitCards, setLoadingAdmitCards] = useState(false);
  const [showAdmitCardModal, setShowAdmitCardModal] = useState(false);
  const [admitCardRules, setAdmitCardRules] = useState({
    enableAttendanceRule: false,
    minAttendancePercent: "75",
    enableFeesRule: false,
    feesClearedTillMonth: "",
    onIneligible: "DENY" as "DENY" | "PROVISIONAL",
  });
  const [generatingAdmitCards, setGeneratingAdmitCards] = useState(false);
  const [admitCardResult, setAdmitCardResult] = useState<any>(null);

  const flattenRooms = (buildings: any[]) =>
    buildings.flatMap((b: any) =>
      (b.floors || []).flatMap((f: any) =>
        (f.rooms || []).map((r: any) => ({ id: r.id, label: `${b.name} / ${f.name || `Floor ${f.floorNo}`} / ${r.roomNo}${r.name ? ` (${r.name})` : ""}` }))
      )
    );

  const load = async () => {
    setLoading(true);
    setError(null);
    
    // FIX: If examId is "new" or empty, this is a create mode - don't try to fetch exam
    if (examId === "new" || !examId) {
      setLoading(false);
      // In create mode, show a friendly message - user needs to select/create an exam first
      // We don't set an error here because this is expected behavior, not an actual error
      return;
    }
    
    // BUG FIX: Next.js App Router reuses this same page component
    // instance when navigating between two different exams' schedule
    // pages (only the `[id]` param changes, no remount) - without
    // resetting everything below, a failed lookup for the NEW examId
    // left the PREVIOUS exam's `exam`/`rows`/`subjects`/etc state
    // untouched, so the timetable table kept showing the old exam's
    // data at the same time as a fresh "Exam not found" error banner.
    // Any open seat-plan/attendance sub-panels are also closed since
    // they're keyed by an examScheduleId that no longer applies here.
    setExam(null);
    setRows([]);
    setSubjects([]);
    setRooms([]);
    setSections([]);
    setPapersByScheduleId({});
    setSeatPlanModalFor(null);
    setViewingSeatPlanFor(null);
    setSeatPlanView(null);
    setMarkingAttendanceFor(null);
    setAttendanceRooms([]);
    setAttendanceEdits({});
    setAdmitCards([]);
    setAdmitCardResult(null);
    try {
      // BUG FIX: this used to fetch the ENTIRE (unscoped) exam list and
      // find this exam client-side - fragile (any transient mismatch
      // between the list and this specific id showed as a false "Exam
      // not found") and slow. getExamById is branch-scoped and fetches
      // exactly this one exam directly.
      const examRes = await api.get(`/academics/exams/${examId}`);
      const found = examRes.data.data;
      if (!found) { 
        setError("Exam not found. Please go to the Exams page and select a valid exam.");
        return; 
      }
      setExam(found);

      // FIX: subjectsRes and scheduleRes previously had NO .catch()
      // (unlike roomsRes/sectionsRes below, which already did). If
      // EITHER of those two sub-requests failed for ANY reason (a
      // transient 404/500, a slow cold-start, a network hiccup), the
      // entire Promise.all rejected - even though the exam itself
      // (examRes above) had already loaded successfully and `setExam`
      // had already run. The resulting catch block then displayed
      // whichever sub-request's own error message happened to bubble
      // up (e.g. getExamSchedule's own "Exam not found" 404 text) as
      // if the EXAM lookup itself had failed - a confusing false
      // negative that looked exactly like a real "exam doesn't exist"
      // error while the page's title/header still showed the exam's
      // real name (fetched a moment earlier via examRes). Every
      // sub-request here now degrades to an empty result on failure
      // instead of taking the whole page down with it.
      const [subjectsRes, scheduleRes, roomsRes, sectionsRes] = await Promise.all([
        api.get(`/classes/${found.classId}/subjects`).catch(() => ({ data: { data: [] } })),
        api.get(`/academics/exams/${examId}/schedule`).catch(() => ({ data: { data: [] } })),
        api.get("/facilities/school-buildings").catch(() => ({ data: { data: [] } })),
        api.get("/classes/sections", { params: { classId: found.classId } }).catch(() => ({ data: { data: [] } })),
      ]);
      setSubjects((subjectsRes.data.data || []).map((cs: any) => cs.subject));
      setRooms(flattenRooms(roomsRes.data.data || []));
      setSections(sectionsRes.data.data || []);

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
      setExam(null);
    } finally {
      setLoading(false);
    }
    fetchAdmitCards();
  };

  useEffect(() => { load(); }, [examId]);

  const fetchAdmitCards = async () => {
    setLoadingAdmitCards(true);
    try {
      const res = await api.get(`/academics/exams/${examId}/admit-cards`);
      setAdmitCards(res.data.data || []);
    } catch {
      setAdmitCards([]);
    } finally {
      setLoadingAdmitCards(false);
    }
  };

  const buildRuleConfig = () => {
    const ruleConfig: any = {};
    if (admitCardRules.enableAttendanceRule) {
      ruleConfig.minAttendancePercent = parseFloat(admitCardRules.minAttendancePercent) || 75;
    }
    if (admitCardRules.enableFeesRule && admitCardRules.feesClearedTillMonth) {
      ruleConfig.feesClearedTillMonth = admitCardRules.feesClearedTillMonth;
    }
    return Object.keys(ruleConfig).length > 0 ? ruleConfig : undefined;
  };

  const handleBulkGenerateAdmitCards = async () => {
    setGeneratingAdmitCards(true);
    setAdmitCardResult(null);
    try {
      const res = await api.post(`/academics/exams/${examId}/admit-cards/bulk-generate`, {
        ruleConfig: buildRuleConfig(),
        onIneligible: admitCardRules.onIneligible,
      });
      setAdmitCardResult(res.data.data);
      await fetchAdmitCards();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to bulk-generate admit cards");
    } finally {
      setGeneratingAdmitCards(false);
    }
  };

  const downloadAdmitCard = async (studentId: string, studentName: string) => {
    try {
      const res = await api.get(`/academics/exams/${examId}/admit-cards/${studentId}/pdf`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noreferrer";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err.response?.data?.message || `Failed to download admit card for ${studentName} (it may have been denied)`);
    }
  };

  const deleteAdmitCard = async (studentId: string) => {
    if (!confirm("Remove this student's admit card record?")) return;
    try {
      await api.delete(`/academics/exams/${examId}/admit-cards/${studentId}`);
      fetchAdmitCards();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to delete admit card");
    }
  };

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

  const openSeatPlanModal = (examScheduleId: string) => {
    setSeatPlanForm({ roomIds: [], arrangement: "ROLL_NO_ORDER", sectionIds: [], gender: "", rollNoFrom: "", rollNoTo: "" });
    setSeatPlanError("");
    setSeatPlanModalFor(examScheduleId);
  };

  const toggleSeatPlanRoom = (roomId: string) => {
    setSeatPlanForm((f) => ({
      ...f,
      roomIds: f.roomIds.includes(roomId) ? f.roomIds.filter((id) => id !== roomId) : [...f.roomIds, roomId],
    }));
  };

  const toggleSeatPlanSection = (sectionId: string) => {
    setSeatPlanForm((f) => ({
      ...f,
      sectionIds: f.sectionIds.includes(sectionId) ? f.sectionIds.filter((id) => id !== sectionId) : [...f.sectionIds, sectionId],
    }));
  };

  const handleGenerateSeatPlan = async () => {
    if (!seatPlanModalFor) return;
    setSeatPlanError("");
    if (seatPlanForm.roomIds.length === 0) {
      setSeatPlanError("Select at least one room");
      return;
    }
    setGeneratingSeatPlan(true);
    try {
      await api.post(`/academics/exams/schedule/${seatPlanModalFor}/seat-plan`, {
        roomIds: seatPlanForm.roomIds,
        arrangement: seatPlanForm.arrangement,
        ...(seatPlanForm.sectionIds.length > 0 && { sectionIds: seatPlanForm.sectionIds }),
        ...(seatPlanForm.gender && { gender: seatPlanForm.gender }),
        ...(seatPlanForm.rollNoFrom && { rollNoFrom: seatPlanForm.rollNoFrom }),
        ...(seatPlanForm.rollNoTo && { rollNoTo: seatPlanForm.rollNoTo }),
      });
      setSeatPlanModalFor(null);
      viewSeatPlan(seatPlanModalFor);
    } catch (err: any) {
      setSeatPlanError(err.response?.data?.message || "Failed to generate seat plan");
    } finally {
      setGeneratingSeatPlan(false);
    }
  };

  const viewSeatPlan = async (examScheduleId: string) => {
    setViewingSeatPlanFor(examScheduleId);
    setLoadingSeatPlanView(true);
    try {
      const res = await api.get(`/academics/exams/schedule/${examScheduleId}/seat-plan`);
      setSeatPlanView(res.data.data);
    } catch {
      setSeatPlanView({ totalSeated: 0, rooms: [] });
    } finally {
      setLoadingSeatPlanView(false);
    }
  };

  const handleClearSeatPlan = async (examScheduleId: string) => {
    if (!confirm("Clear the entire seat plan for this subject? This cannot be undone.")) return;
    try {
      await api.delete(`/academics/exams/schedule/${examScheduleId}/seat-plan`);
      viewSeatPlan(examScheduleId);
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to clear seat plan");
    }
  };

  const downloadSeatSlip = async (examScheduleId: string, studentId: string, studentName: string) => {
    try {
      const res = await api.get(`/academics/exams/schedule/${examScheduleId}/seat-plan/student/${studentId}/slip`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noreferrer";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(`Failed to download seat slip for ${studentName}`);
    }
  };

  const openAttendancePanel = async (examScheduleId: string) => {
    setMarkingAttendanceFor(examScheduleId);
    setAttendanceMessage("");
    setLoadingAttendance(true);
    try {
      const res = await api.get(`/academics/exams/schedule/${examScheduleId}/attendance`);
      const roomsData = res.data.data?.rooms || [];
      setAttendanceRooms(roomsData);
      const edits: Record<string, string> = {};
      for (const room of roomsData) {
        for (const s of room.students) {
          if (s.status) edits[s.studentId] = s.status;
        }
      }
      setAttendanceEdits(edits);
    } catch (err: any) {
      setAttendanceRooms([]);
      setAttendanceMessage(err.response?.data?.message || "Failed to load exam attendance");
    } finally {
      setLoadingAttendance(false);
    }
  };

  const setAttendanceStatus = (studentId: string, status: string) => {
    setAttendanceEdits((prev) => ({ ...prev, [studentId]: status }));
  };

  const markAllPresent = (roomStudents: any[]) => {
    setAttendanceEdits((prev) => {
      const next = { ...prev };
      for (const s of roomStudents) next[s.studentId] = "PRESENT";
      return next;
    });
  };

  const handleSaveAttendance = async (roomId: string | null) => {
    if (!markingAttendanceFor) return;
    const room = attendanceRooms.find((r) => r.roomId === roomId);
    if (!room) return;
    const records = room.students
      .filter((s: any) => attendanceEdits[s.studentId])
      .map((s: any) => ({ studentId: s.studentId, status: attendanceEdits[s.studentId] }));
    if (records.length === 0) {
      setAttendanceMessage("Mark at least one student's status before saving");
      return;
    }
    setSavingAttendance(true);
    setAttendanceMessage("");
    try {
      await api.post(`/academics/exams/schedule/${markingAttendanceFor}/attendance`, {
        ...(roomId && { roomId }),
        records,
      });
      setAttendanceMessage("Attendance saved");
    } catch (err: any) {
      setAttendanceMessage(err.response?.data?.message || "Failed to save attendance");
    } finally {
      setSavingAttendance(false);
    }
  };

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
          <p className="text-gray-500 mt-1">
            {loading ? "Loading..." : exam ? `${exam.name} - ${exam.class?.name}` : examId === "new" || !examId ? "Select an exam to create timetable" : "No exam selected"}
          </p>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
        </div>
      ) : !exam && (examId === "new" || !examId) ? (
        <div className="card">
          <div className="text-center py-8">
            <CalendarClock className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-700 mb-2">No Exam Selected</h3>
            <p className="text-gray-500 mb-4">Please select an exam from the Exams page to create or view its timetable.</p>
            <a href="/dashboard/exams" className="btn-primary inline-flex items-center gap-2">
              Go to Exams Page
            </a>
          </div>
        </div>
      ) : exam && !error ? (
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
                      <div className="flex items-center gap-2">
                        {isAdmin && (
                          <button onClick={() => openSeatPlanModal(r.id!)} className="btn-secondary flex items-center gap-2 text-xs">
                            <Armchair className="h-3.5 w-3.5" /> Seat Plan
                          </button>
                        )}
                        <button onClick={() => viewSeatPlan(r.id!)} className="btn-secondary flex items-center gap-2 text-xs">
                          <Users className="h-3.5 w-3.5" /> View Seating
                        </button>
                        <button onClick={() => openAttendancePanel(r.id!)} className="btn-secondary flex items-center gap-2 text-xs">
                          <ClipboardCheck className="h-3.5 w-3.5" /> Exam Attendance
                        </button>
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

                    {viewingSeatPlanFor === r.id && (
                      <div className="mt-3 pt-3 border-t">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-sm font-semibold flex items-center gap-2"><Armchair className="h-4 w-4 text-teal-600" /> Seat Plan</h4>
                          <div className="flex items-center gap-2">
                            {isAdmin && seatPlanView?.totalSeated > 0 && (
                              <button onClick={() => handleClearSeatPlan(r.id!)} className="text-xs text-red-500 hover:text-red-700">Clear Plan</button>
                            )}
                            <button onClick={() => setViewingSeatPlanFor(null)} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
                          </div>
                        </div>
                        {loadingSeatPlanView ? (
                          <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-primary-600" /></div>
                        ) : seatPlanView?.totalSeated > 0 ? (
                          <div className="space-y-3">
                            {seatPlanView.rooms.map((room: any) => (
                              <div key={room.roomId} className="border rounded-lg p-2">
                                <div className="text-xs font-medium mb-1">
                                  Room {room.roomNo}{room.roomName ? ` (${room.roomName})` : ""} - {room.seats.length} seated
                                  <span className="text-gray-400 ml-2">({room.maleCount} boys / {room.femaleCount} girls{room.otherCount ? ` / ${room.otherCount} other` : ""})</span>
                                </div>
                                <table className="w-full text-xs">
                                  <thead><tr className="text-gray-500"><th className="text-left py-1">Seat</th><th className="text-left py-1">Name</th><th className="text-left py-1">Roll No</th><th className="text-left py-1">Section</th><th className="text-left py-1">Gender</th><th className="text-right py-1">Slip</th></tr></thead>
                                  <tbody>
                                    {room.seats.map((seat: any) => (
                                      <tr key={seat.studentId} className="border-t">
                                        <td className="py-1">{seat.seatNo}</td>
                                        <td className="py-1">{seat.studentName}</td>
                                        <td className="py-1">{seat.rollNo || "-"}</td>
                                        <td className="py-1">{seat.sectionName || "-"}</td>
                                        <td className="py-1">{seat.gender}</td>
                                        <td className="py-1 text-right">
                                          <button onClick={() => downloadSeatSlip(r.id!, seat.studentId, seat.studentName)} className="text-primary-600 hover:underline">Slip</button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-400">No seat plan generated yet for this subject.</p>
                        )}
                      </div>
                    )}

                    {markingAttendanceFor === r.id && (
                      <div className="mt-3 pt-3 border-t">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-sm font-semibold flex items-center gap-2"><ClipboardCheck className="h-4 w-4 text-emerald-600" /> Exam Attendance</h4>
                          <button onClick={() => setMarkingAttendanceFor(null)} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
                        </div>
                        {attendanceMessage && (
                          <div className="mb-2 text-xs rounded px-2 py-1 bg-blue-50 text-blue-700 border border-blue-200">{attendanceMessage}</div>
                        )}
                        {loadingAttendance ? (
                          <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-primary-600" /></div>
                        ) : attendanceRooms.length === 0 ? (
                          <p className="text-xs text-gray-400">No students found for this exam's class.</p>
                        ) : (
                          <div className="space-y-3">
                            {attendanceRooms.map((room: any) => (
                              <div key={room.roomId || "unroomed"} className="border rounded-lg p-2">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-xs font-medium">
                                    {room.roomNo ? `Room ${room.roomNo}${room.roomName ? ` (${room.roomName})` : ""}` : "All Students"} - {room.students.length} student(s)
                                  </span>
                                  <button onClick={() => markAllPresent(room.students)} className="text-xs text-primary-600 hover:underline">Mark all Present</button>
                                </div>
                                <table className="w-full text-xs">
                                  <thead><tr className="text-gray-500"><th className="text-left py-1">Name</th><th className="text-left py-1">Roll No</th><th className="text-left py-1">Status</th></tr></thead>
                                  <tbody>
                                    {room.students.map((s: any) => (
                                      <tr key={s.studentId} className="border-t">
                                        <td className="py-1">{s.studentName}</td>
                                        <td className="py-1">{s.rollNo || "-"}</td>
                                        <td className="py-1">
                                          <select
                                            className="input-field text-xs py-0.5"
                                            value={attendanceEdits[s.studentId] || ""}
                                            onChange={(e) => setAttendanceStatus(s.studentId, e.target.value)}
                                          >
                                            <option value="">-</option>
                                            <option value="PRESENT">Present</option>
                                            <option value="ABSENT">Absent</option>
                                            <option value="LATE">Late</option>
                                            <option value="UNFAIR_MEANS">Unfair Means</option>
                                          </select>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                <div className="flex justify-end mt-2">
                                  <button
                                    onClick={() => handleSaveAttendance(room.roomId)}
                                    disabled={savingAttendance}
                                    className="btn-primary text-xs flex items-center gap-1 disabled:opacity-60"
                                  >
                                    {savingAttendance && <Loader2 className="h-3 w-3 animate-spin" />} Save
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="card mt-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold flex items-center gap-2"><Contact className="h-5 w-5 text-rose-600" /> Admit Cards</h3>
              {isAdmin && (
                <button onClick={() => { setAdmitCardResult(null); setShowAdmitCardModal(true); }} className="btn-primary flex items-center gap-2 text-sm">
                  <Contact className="h-4 w-4" /> Bulk Generate
                </button>
              )}
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Generate admit cards for every active student in this class, optionally gated by eligibility rules
              (minimum attendance %, fees cleared through a chosen month). A student who fails a rule can either be
              denied a card entirely, or issued a provisional card limited to the subjects already scheduled -
              re-run generation after they fix the issue to get an updated card.
            </p>

            {loadingAdmitCards ? (
              <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-primary-600" /></div>
            ) : admitCards.length === 0 ? (
              <p className="text-sm text-gray-400">No admit cards generated yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b bg-gray-50">
                    <th className="px-3 py-2 text-left">Student</th>
                    <th className="px-3 py-2 text-left">Roll No</th>
                    <th className="px-3 py-2 text-center">Status</th>
                    <th className="px-3 py-2 text-left">Remarks</th>
                    <th className="px-3 py-2 text-center">Actions</th>
                  </tr></thead>
                  <tbody>
                    {admitCards.map((ac: any) => (
                      <tr key={ac.id} className="border-b">
                        <td className="px-3 py-2">{ac.student?.user?.name}</td>
                        <td className="px-3 py-2">{ac.student?.rollNo || "-"}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-xs ${ac.status === "ELIGIBLE" ? "bg-green-100 text-green-700" : ac.status === "PROVISIONAL" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
                            {ac.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-500">{ac.remarks || "-"}</td>
                        <td className="px-3 py-2 text-center">
                          <div className="flex items-center justify-center gap-3">
                            {ac.status !== "DENIED" && (
                              <button onClick={() => downloadAdmitCard(ac.student.id, ac.student.user.name)} className="text-primary-600 hover:underline flex items-center gap-1">
                                <Download className="h-3.5 w-3.5" /> PDF
                              </button>
                            )}
                            {isAdmin && (
                              <button onClick={() => deleteAdmitCard(ac.student.id)} className="text-red-500 hover:text-red-700"><Trash2 className="h-3.5 w-3.5" /></button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}

      <Modal isOpen={showAdmitCardModal} onClose={() => setShowAdmitCardModal(false)} title="Bulk Generate Admit Cards" size="md">
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Every active student in <strong>{exam?.class?.name}</strong> will be evaluated against the rules you enable below.
          </p>

          <div className="border rounded-lg p-3 space-y-3">
            <p className="text-sm font-medium text-gray-700">Eligibility Rules Checklist</p>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={admitCardRules.enableAttendanceRule}
                onChange={(e) => setAdmitCardRules({ ...admitCardRules, enableAttendanceRule: e.target.checked })}
              />
              <span className="flex-1">
                Minimum attendance %
                {admitCardRules.enableAttendanceRule && (
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className="input-field w-20 inline-block ml-2 py-1"
                    value={admitCardRules.minAttendancePercent}
                    onChange={(e) => setAdmitCardRules({ ...admitCardRules, minAttendancePercent: e.target.value })}
                  />
                )}
                <span className="text-xs text-gray-400 block mt-0.5">Computed over the academic year so far (default 75%)</span>
              </span>
            </label>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={admitCardRules.enableFeesRule}
                onChange={(e) => setAdmitCardRules({ ...admitCardRules, enableFeesRule: e.target.checked })}
              />
              <span className="flex-1">
                Monthly fees cleared through
                {admitCardRules.enableFeesRule && (
                  <input
                    type="month"
                    className="input-field w-40 inline-block ml-2 py-1"
                    value={admitCardRules.feesClearedTillMonth}
                    onChange={(e) => setAdmitCardRules({ ...admitCardRules, feesClearedTillMonth: e.target.value })}
                  />
                )}
                <span className="text-xs text-gray-400 block mt-0.5">Only MONTHLY-frequency fee structures are checked</span>
              </span>
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">If a student fails a rule:</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="onIneligible" checked={admitCardRules.onIneligible === "DENY"} onChange={() => setAdmitCardRules({ ...admitCardRules, onIneligible: "DENY" })} />
                Deny admit card entirely
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="onIneligible" checked={admitCardRules.onIneligible === "PROVISIONAL"} onChange={() => setAdmitCardRules({ ...admitCardRules, onIneligible: "PROVISIONAL" })} />
                Issue provisional (only scheduled subjects)
              </label>
            </div>
          </div>

          {admitCardResult && (
            <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 text-blue-800 text-sm rounded-lg px-3 py-2">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>
                Generated {admitCardResult.total} admit card(s): {admitCardResult.eligible} eligible, {admitCardResult.provisional} provisional, {admitCardResult.denied} denied.
              </span>
            </div>
          )}

          {!admitCardRules.enableAttendanceRule && !admitCardRules.enableFeesRule && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-3 py-2">
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" /> No rules enabled - every active student will simply get an ELIGIBLE card.
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2 border-t">
            <button type="button" onClick={() => setShowAdmitCardModal(false)} className="btn-secondary">Close</button>
            <button type="button" onClick={handleBulkGenerateAdmitCards} disabled={generatingAdmitCards} className="btn-primary flex items-center gap-2 disabled:opacity-60">
              {generatingAdmitCards && <Loader2 className="h-4 w-4 animate-spin" />} {generatingAdmitCards ? "Generating..." : "Generate for Whole Class"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!seatPlanModalFor} onClose={() => setSeatPlanModalFor(null)} title="Generate Seat Plan" size="md">
        <div className="space-y-4">
          {seatPlanError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{seatPlanError}</div>}
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-3 py-2">
            Regenerating replaces any existing seat plan for this subject.
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Rooms *</label>
            <div className="border rounded-lg max-h-40 overflow-y-auto p-2 space-y-1">
              {rooms.length === 0 ? (
                <p className="text-xs text-gray-400">No rooms found - add rooms under School Buildings first.</p>
              ) : (
                rooms.map((rm) => (
                  <label key={rm.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={seatPlanForm.roomIds.includes(rm.id)} onChange={() => toggleSeatPlanRoom(rm.id)} />
                    {rm.label}
                  </label>
                ))
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Arrangement</label>
            <select className="input-field" value={seatPlanForm.arrangement} onChange={(e) => setSeatPlanForm({ ...seatPlanForm, arrangement: e.target.value as any })}>
              <option value="ROLL_NO_ORDER">Roll No Order</option>
              <option value="ALTERNATE_GENDER">Alternate Boy/Girl</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Sections (optional - default: all)</label>
            <div className="flex flex-wrap gap-2">
              {sections.map((s) => (
                <label key={s.id} className="flex items-center gap-1 text-sm bg-gray-50 rounded px-2 py-1">
                  <input type="checkbox" checked={seatPlanForm.sectionIds.includes(s.id)} onChange={() => toggleSeatPlanSection(s.id)} />
                  {s.name}
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Gender</label>
              <select className="input-field" value={seatPlanForm.gender} onChange={(e) => setSeatPlanForm({ ...seatPlanForm, gender: e.target.value })}>
                <option value="">All</option>
                <option value="MALE">Boys only</option>
                <option value="FEMALE">Girls only</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Roll No From</label>
              <input className="input-field" value={seatPlanForm.rollNoFrom} onChange={(e) => setSeatPlanForm({ ...seatPlanForm, rollNoFrom: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Roll No To</label>
              <input className="input-field" value={seatPlanForm.rollNoTo} onChange={(e) => setSeatPlanForm({ ...seatPlanForm, rollNoTo: e.target.value })} />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t">
            <button type="button" onClick={() => setSeatPlanModalFor(null)} className="btn-secondary">Cancel</button>
            <button type="button" onClick={handleGenerateSeatPlan} disabled={generatingSeatPlan} className="btn-primary flex items-center gap-2 disabled:opacity-60">
              {generatingSeatPlan && <Loader2 className="h-4 w-4 animate-spin" />} {generatingSeatPlan ? "Generating..." : "Generate Seat Plan"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
