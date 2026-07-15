"use client";

import { useState, useEffect } from "react";
import { FileUp, Trash2, Download, FileText } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { formatDate } from "@/lib/utils";
import { resolveUploadUrl } from "@/lib/uploads";
import { usePermissions } from "@/hooks/usePermissions";


interface QuestionPaper {
  id: string;
  fileName: string;
  fileUrl: string;
  uploadedBy: string;
  createdAt: string;
  examSchedule?: { exam?: { name: string }; subject?: { name: string } };
}

export default function QuestionPapersPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "SUPER_ADMIN" || user?.role === "BRANCH_ADMIN";
  const { canDelete } = usePermissions();

  const [papers, setPapers] = useState<QuestionPaper[]>([]);
  const [loading, setLoading] = useState(true);
  const [exams, setExams] = useState<any[]>([]);
  const [selectedExamId, setSelectedExamId] = useState("");
  const [schedules, setSchedules] = useState<any[]>([]);
  const [selectedScheduleId, setSelectedScheduleId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  // ROOT CAUSE FIX: this page's ONLY user-facing feedback for upload/
  // delete was `alert()`. In practice `window.alert()`/`confirm()` are
  // silently no-ops in several real environments this app runs in -
  // a sandboxed preview iframe without "allow-modals", or a browser
  // tab where the user has already dismissed a couple of alerts and
  // ticked "Prevent this page from creating additional dialogs" (very
  // easy to hit during a long QA session that hits several other
  // alert()-based error dialogs first). When that happens the request
  // still completes exactly as before (resolves or rejects normally -
  // that's why the button correctly flips "Uploading..." -> "Upload",
  // since `finally { setUploading(false) }` still runs) but NEITHER
  // the success path nor the catch's alert() ever becomes visible, so
  // it looks indistinguishable from total silent failure even when the
  // backend actually returned a perfectly good 4xx/5xx error (or a
  // 201!). Rendering the message inline instead guarantees it's always
  // visible regardless of the browser/embedding context.
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    api.get("/academics/exams").then((res) => setExams(res.data.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedExamId) {
      api.get(`/academics/exams/${selectedExamId}/schedule`).then((res) => setSchedules(res.data.data || [])).catch(() => setSchedules([]));
    } else {
      setSchedules([]);
    }
    setSelectedScheduleId("");
  }, [selectedExamId]);

  const fetchPapers = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (selectedExamId) params.examId = selectedExamId;
      const res = await api.get("/academics/exams/question-papers", { params });
      setPapers(res.data.data || []);
    } catch { setPapers([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchPapers(); }, [selectedExamId]);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !selectedScheduleId) return;
    setUploading(true);
    setFeedback(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("examScheduleId", selectedScheduleId);
      // BUG FIX: manually setting `Content-Type: multipart/form-data`
      // here (with NO `boundary` parameter) is what caused the stuck-
      // forever "Uploading..." state. A multipart body's Content-Type
      // MUST include a boundary string (e.g.
      // "multipart/form-data; boundary=----WebKitFormBoundary...") so
      // the receiving parser knows where one field/file ends and the
      // next begins - the browser normally generates this
      // automatically from the FormData object as long as NO
      // Content-Type header is explicitly present on the request.
      // Explicitly setting `Content-Type: undefined` below (rather
      // than just omitting the option) is needed because the shared
      // `api` axios instance (see lib/api.ts) already sets a default
      // "Content-Type": "application/json" header - simply not
      // passing a `headers` option here would let that default leak
      // through instead of a real multipart boundary. Either the
      // boundary-less header or the wrong "application/json" header
      // left the backend's multer middleware (middleware/upload.ts)
      // unable to parse a body at all, so the request never cleanly
      // resolved OR rejected - `finally { setUploading(false) }` never
      // ran, and the button stayed stuck on "Uploading..." forever.
      await api.post("/academics/exams/question-papers", formData, {
        headers: { "Content-Type": undefined },
      });
      setFile(null);
      setFeedback({ type: "success", text: "Question paper uploaded successfully." });
      fetchPapers();
    } catch (err: any) {
      // ROOT CAUSE FIX: previously this only called `alert(...)`. If the
      // request is rejected by the backend (e.g. a TEACHER who isn't
      // assigned to teach this subject/class gets a 403 here - see
      // canTeacherTeachSubjectForClass in teacherAccess.ts - or any
      // other 4xx/5xx), that rejection was completely invisible
      // whenever `window.alert()` is suppressed by the browser/host
      // environment (e.g. an embedded preview iframe without
      // "allow-modals", or after a user has dismissed a few alerts and
      // the browser auto-mutes further ones for the page) - the button
      // still correctly flips back to "Upload" (the `finally` below
      // still runs) but NEITHER a success nor an error message ever
      // becomes visible, which is indistinguishable from the upload
      // "just doing nothing". Rendering the message inline in the page
      // guarantees the real reason (including the exact backend
      // message) is always visible.
      setFeedback({ type: "error", text: err.response?.data?.message || "Upload failed" });
    } finally { setUploading(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this question paper?")) return;
    try {
      await api.delete(`/academics/exams/question-papers/${id}`);
      fetchPapers();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <FileText className="h-6 w-6 text-primary-600" /> Exam Question Papers
        </h1>
        <p className="text-gray-500 mt-1">Upload and manage question papers for exams</p>
      </div>

      {/* Upload Form */}
      <div className="card mb-6">
        <h3 className="font-semibold mb-3">Upload Question Paper</h3>
        <form onSubmit={handleUpload} className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs font-medium mb-1">Exam</label>
            <select className="input-field" value={selectedExamId} onChange={(e) => setSelectedExamId(e.target.value)}>
              <option value="">Select Exam</option>
              {exams.map((ex) => <option key={ex.id} value={ex.id}>{ex.name} ({ex.class?.name})</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs font-medium mb-1">Subject (Schedule)</label>
            <select className="input-field" value={selectedScheduleId} onChange={(e) => setSelectedScheduleId(e.target.value)} disabled={!schedules.length}>
              <option value="">Select Subject</option>
              {schedules.map((s: any) => <option key={s.id} value={s.id}>{s.subject?.name} - {formatDate(s.examDate)}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs font-medium mb-1">File (PDF/DOCX)</label>
            <input type="file" accept=".pdf,.docx,.doc" onChange={(e) => setFile(e.target.files?.[0] || null)} className="input-field text-sm" />
          </div>
          <button type="submit" disabled={uploading || !file || !selectedScheduleId} className="btn-primary flex items-center gap-1.5 disabled:opacity-50">
            <FileUp className="h-4 w-4" /> {uploading ? "Uploading..." : "Upload"}
          </button>
        </form>
        {feedback && (
          <p className={`mt-3 text-sm ${feedback.type === "success" ? "text-green-600" : "text-red-600"}`}>
            {feedback.text}
          </p>
        )}
      </div>

      {/* Papers List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
        </div>
      ) : papers.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-500">No question papers uploaded yet.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="px-4 py-3 text-left">File</th>
                <th className="px-4 py-3 text-left">Exam</th>
                <th className="px-4 py-3 text-left">Subject</th>
                <th className="px-4 py-3 text-left">Uploaded</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {papers.map((p) => (
                <tr key={p.id} className="border-b">
                  <td className="px-4 py-3 font-medium">{p.fileName}</td>
                  <td className="px-4 py-3">{p.examSchedule?.exam?.name || "-"}</td>
                  <td className="px-4 py-3">{p.examSchedule?.subject?.name || "-"}</td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(p.createdAt)}</td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex justify-center gap-2">
                      {/* ROOT CAUSE FIX: p.fileUrl is a backend-relative path
                          (e.g. "/uploads/exam-question-papers/..."), stored
                          that way because the backend doesn't know its own
                          public origin at write time (see
                          storage.service.ts's LocalStorageProvider.save()).
                          A relative href resolves against the CURRENT
                          document's origin - the Next.js frontend - which
                          has no route at that path, so it 404'd. Every other
                          download/preview link in this app already resolves
                          the URL against the backend's own origin via
                          resolveUploadUrl() (see lib/uploads.ts); this link
                          was the one place still using the raw relative URL. */}
                      <a href={resolveUploadUrl(p.fileUrl)} target="_blank" rel="noreferrer" className="p-1.5 text-primary-600 hover:bg-primary-50 rounded" title="Download">
                        <Download className="h-4 w-4" />
                      </a>
                      {canDelete && (
                        <button onClick={() => handleDelete(p.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded" title="Delete">
                          <Trash2 className="h-4 w-4" />
                        </button>
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
  );
}
