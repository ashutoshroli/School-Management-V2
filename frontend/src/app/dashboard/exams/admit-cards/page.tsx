"use client";

import { useState, useEffect } from "react";
import { CreditCard, Download, Trash2, Play } from "lucide-react";
import api from "@/lib/api";
import { formatDate } from "@/lib/utils";


export default function AdmitCardsPage() {
  const [exams, setExams] = useState<any[]>([]);
  const [selectedExamId, setSelectedExamId] = useState("");
  const [admitCards, setAdmitCards] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    api.get("/academics/exams").then((res) => setExams(res.data.data || [])).catch(() => {});
  }, []);

  const fetchAdmitCards = async () => {
    if (!selectedExamId) return;
    setLoading(true);
    try {
      const res = await api.get(`/academics/exams/${selectedExamId}/admit-cards`);
      setAdmitCards(res.data.data || []);
    } catch { setAdmitCards([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (selectedExamId) fetchAdmitCards(); else setAdmitCards([]); }, [selectedExamId]);

  const handleBulkGenerate = async () => {
    if (!selectedExamId) return;
    if (!confirm("Generate admit cards for ALL eligible students in this exam?")) return;
    setGenerating(true);
    try {
      const res = await api.post(`/academics/exams/${selectedExamId}/admit-cards/bulk-generate`, {});
      const data = res.data.data;
      alert(`Generated: ${data?.generated || 0}, Skipped: ${data?.skipped || 0}, Denied: ${data?.denied || 0}`);
      fetchAdmitCards();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to generate admit cards");
    } finally { setGenerating(false); }
  };

  const handleDelete = async (studentId: string) => {
    if (!confirm("Delete this admit card?")) return;
    try {
      await api.delete(`/academics/exams/${selectedExamId}/admit-cards/${studentId}`);
      fetchAdmitCards();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  const statusColors: Record<string, string> = {
    ELIGIBLE: "bg-green-100 text-green-700",
    PROVISIONAL: "bg-yellow-100 text-yellow-700",
    DENIED: "bg-red-100 text-red-700",
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <CreditCard className="h-6 w-6 text-primary-600" /> Admit Cards
        </h1>
        <p className="text-gray-500 mt-1">Generate and manage exam admit cards with eligibility checks</p>
      </div>

      <div className="card mb-6">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium mb-1">Select Exam</label>
            <select className="input-field" value={selectedExamId} onChange={(e) => setSelectedExamId(e.target.value)}>
              <option value="">Choose an exam...</option>
              {exams.map((ex) => <option key={ex.id} value={ex.id}>{ex.name} ({ex.class?.name})</option>)}
            </select>
          </div>
          {selectedExamId && (
            <button onClick={handleBulkGenerate} disabled={generating} className="btn-primary flex items-center gap-1.5 disabled:opacity-50">
              <Play className="h-4 w-4" /> {generating ? "Generating..." : "Bulk Generate"}
            </button>
          )}
        </div>
      </div>

      {!selectedExamId ? (
        <div className="card text-center py-12">
          <p className="text-gray-500">Select an exam to view or generate admit cards.</p>
        </div>
      ) : loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
        </div>
      ) : admitCards.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-500">No admit cards generated yet. Click &quot;Bulk Generate&quot; to create for all eligible students.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="px-4 py-3 text-left">Student</th>
                <th className="px-4 py-3 text-left">Admission No</th>
                <th className="px-4 py-3 text-left">Serial No</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-left">Generated</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {admitCards.map((ac: any) => (
                <tr key={ac.id} className="border-b">
                  <td className="px-4 py-3 font-medium">{ac.student?.user?.name || "-"}</td>
                  <td className="px-4 py-3 font-mono text-xs">{ac.student?.admissionNo || "-"}</td>
                  <td className="px-4 py-3 font-mono text-xs">{ac.serialNo}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[ac.status] || "bg-gray-100 text-gray-700"}`}>
                      {ac.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(ac.generatedAt)}</td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex justify-center gap-2">
                      <a href={`/api/academics/exams/${selectedExamId}/admit-cards/${ac.student?.id || ac.studentId}/pdf`} target="_blank" rel="noreferrer" className="p-1.5 text-primary-600 hover:bg-primary-50 rounded" title="Download PDF">
                        <Download className="h-4 w-4" />
                      </a>
                      <button onClick={() => handleDelete(ac.student?.id || ac.studentId)} className="p-1.5 text-red-500 hover:bg-red-50 rounded" title="Delete">
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
