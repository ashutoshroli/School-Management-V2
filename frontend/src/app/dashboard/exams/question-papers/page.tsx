"use client";

import { useState, useEffect } from "react";
import { FileUp, Trash2, Download, FileText } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { formatDate } from "@/lib/utils";


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

  const [papers, setPapers] = useState<QuestionPaper[]>([]);
  const [loading, setLoading] = useState(true);
  const [exams, setExams] = useState<any[]>([]);
  const [selectedExamId, setSelectedExamId] = useState("");
  const [schedules, setSchedules] = useState<any[]>([]);
  const [selectedScheduleId, setSelectedScheduleId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);

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
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("examScheduleId", selectedScheduleId);
      await api.post("/academics/exams/question-papers", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setFile(null);
      fetchPapers();
    } catch (err: any) {
      alert(err.response?.data?.message || "Upload failed");
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
                      <a href={p.fileUrl} target="_blank" rel="noreferrer" className="p-1.5 text-primary-600 hover:bg-primary-50 rounded" title="Download">
                        <Download className="h-4 w-4" />
                      </a>
                      <button onClick={() => handleDelete(p.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded" title="Delete">
                        <Trash2 className="h-4 w-4" />
                      </button>
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
