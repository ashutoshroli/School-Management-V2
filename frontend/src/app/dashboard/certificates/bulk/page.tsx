"use client";

import { useState, useEffect } from "react";
import { Award, Play, CheckCircle2, AlertCircle } from "lucide-react";
import api from "@/lib/api";


export default function BulkCertificatesPage() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [classes, setClasses] = useState<any[]>([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [sections, setSections] = useState<any[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState("");
  const [students, setStudents] = useState<any[]>([]);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    api.get("/communication/certificates/templates").then((res) => setTemplates(res.data.data || [])).catch(() => {});
    api.get("/classes").then((res) => setClasses(res.data.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedClassId) {
      api.get("/classes/sections", { params: { classId: selectedClassId } }).then((res) => setSections(res.data.data || [])).catch(() => setSections([]));
    } else { setSections([]); }
    setSelectedSectionId("");
    setStudents([]);
    setSelectedStudentIds([]);
  }, [selectedClassId]);

  useEffect(() => {
    if (selectedClassId) {
      const params: any = { classId: selectedClassId };
      if (selectedSectionId) params.sectionId = selectedSectionId;
      api.get("/students", { params }).then((res) => {
        setStudents(res.data.data || []);
        setSelectedStudentIds((res.data.data || []).map((s: any) => s.id));
      }).catch(() => setStudents([]));
    }
  }, [selectedClassId, selectedSectionId]);

  const toggleStudent = (id: string) => {
    setSelectedStudentIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const toggleAll = () => {
    setSelectedStudentIds((prev) => prev.length === students.length ? [] : students.map((s) => s.id));
  };

  const handleGenerate = async () => {
    if (!selectedTemplateId || selectedStudentIds.length === 0) {
      setResult({ type: "error", text: "Select a template and at least one student." });
      return;
    }
    if (!confirm(`Generate certificates for ${selectedStudentIds.length} students?`)) return;
    setGenerating(true);
    setResult(null);
    try {
      const res = await api.post("/communication/certificates/generate/bulk", {
        templateId: selectedTemplateId,
        studentIds: selectedStudentIds,
      });
      const data = res.data.data;
      setResult({ type: "success", text: `Successfully generated ${data?.generated || selectedStudentIds.length} certificates!` });
    } catch (err: any) {
      setResult({ type: "error", text: err.response?.data?.message || "Failed to generate certificates" });
    } finally { setGenerating(false); }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Award className="h-6 w-6 text-primary-600" /> Bulk Certificate Generation
        </h1>
        <p className="text-gray-500 mt-1">Generate certificates for multiple students at once</p>
      </div>

      {result && (
        <div className={`mb-4 p-3 rounded-lg text-sm border flex items-center gap-2 ${
          result.type === "success" ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"
        }`}>
          {result.type === "success" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {result.text}
        </div>
      )}

      <div className="card mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium mb-1">Certificate Template *</label>
            <select className="input-field" value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)}>
              <option value="">Select Template</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.type})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Class *</label>
            <select className="input-field" value={selectedClassId} onChange={(e) => setSelectedClassId(e.target.value)}>
              <option value="">Select Class</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Section (optional)</label>
            <select className="input-field" value={selectedSectionId} onChange={(e) => setSelectedSectionId(e.target.value)}>
              <option value="">All Sections</option>
              {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <button onClick={handleGenerate} disabled={generating || !selectedTemplateId || selectedStudentIds.length === 0} className="btn-primary w-full flex items-center justify-center gap-1.5 disabled:opacity-50">
              <Play className="h-4 w-4" /> {generating ? "Generating..." : `Generate (${selectedStudentIds.length})`}
            </button>
          </div>
        </div>
      </div>

      {students.length > 0 && (
        <div className="card overflow-x-auto">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-gray-600">{selectedStudentIds.length} of {students.length} students selected</p>
            <button onClick={toggleAll} className="text-sm text-primary-600 hover:text-primary-700">
              {selectedStudentIds.length === students.length ? "Deselect All" : "Select All"}
            </button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="px-4 py-2 text-center w-12"><input type="checkbox" checked={selectedStudentIds.length === students.length} onChange={toggleAll} /></th>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left">Admission No</th>
                <th className="px-4 py-2 text-left">Class</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id} className="border-b">
                  <td className="px-4 py-2 text-center"><input type="checkbox" checked={selectedStudentIds.includes(s.id)} onChange={() => toggleStudent(s.id)} /></td>
                  <td className="px-4 py-2 font-medium">{s.user?.name}</td>
                  <td className="px-4 py-2 font-mono text-xs">{s.admissionNo}</td>
                  <td className="px-4 py-2">{s.class?.name} - {s.section?.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
