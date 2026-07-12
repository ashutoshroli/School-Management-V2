"use client";

import { useState, useEffect } from "react";
import { Award, Plus, FileDown, X } from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";
import { formatDate } from "@/lib/utils";
import { resolveUploadUrl } from "@/lib/uploads";

// TRANSFER_CERTIFICATE/BONAFIDE/CHARACTER have a hardcoded PDFKit
// layout as a fallback (see certificateGenerator.service.ts), so they
// always produce a PDF even with no template uploaded. ID_CARD has its
// own dedicated endpoint (per-student "ID Card" button on the student
// profile page) - not generated from here at all. CUSTOM has NO
// hardcoded fallback: it only produces a PDF once a .docx template is
// uploaded for it on the Templates page, and any "Custom Fields" below
// fill that template's own {{placeholders}} (student/branch fields
// aren't enough since a CUSTOM template's fields aren't known ahead of time).
const SUPPORTED_TYPES = ["TRANSFER_CERTIFICATE", "BONAFIDE", "CHARACTER"];

export default function CertificatesPage() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [generated, setGenerated] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ templateId: "", studentSearch: "", studentId: "", purpose: "" });
  const [students, setStudents] = useState<any[]>([]);
  const [generating, setGenerating] = useState(false);

  // CUSTOM-type certificates have no fixed field set (unlike
  // Transfer/Bonafide/Character), so the admin supplies whatever
  // {{placeholder}} key/value pairs their uploaded template needs,
  // right here at generation time - the generic renderer for CUSTOM
  // templates the gap-analysis called out as a real missing feature.
  const [customFields, setCustomFields] = useState<{ key: string; value: string }[]>([{ key: "", value: "" }]);

  const selectedTemplate = templates.find((t) => t.id === form.templateId);
  const isCustomType = selectedTemplate?.type === "CUSTOM";

  const updateCustomField = (index: number, field: "key" | "value", value: string) => {
    setCustomFields((prev) => prev.map((cf, i) => (i === index ? { ...cf, [field]: value } : cf)));
  };
  const addCustomFieldRow = () => setCustomFields((prev) => [...prev, { key: "", value: "" }]);
  const removeCustomFieldRow = (index: number) => setCustomFields((prev) => prev.filter((_, i) => i !== index));

  // Filters for the "Generated Certificates" list - type/classId/date
  // range, previously impossible on the backend (only studentId existed).
  const [filterType, setFilterType] = useState("");
  const [filterClassId, setFilterClassId] = useState("");
  const [filterFromDate, setFilterFromDate] = useState("");
  const [filterToDate, setFilterToDate] = useState("");
  const [classes, setClasses] = useState<any[]>([]);

  useEffect(() => {
    api.get("/classes").then((res) => setClasses(res.data.data || [])).catch(() => {});
  }, []);

  const fetch = async () => {
    setLoading(true);
    try {
      const [tRes, gRes] = await Promise.all([
        api.get("/communication/certificates/templates"),
        api.get("/communication/certificates/generated", {
          params: {
            type: filterType || undefined,
            classId: filterClassId || undefined,
            fromDate: filterFromDate || undefined,
            toDate: filterToDate || undefined,
          },
        }),
      ]);
      setTemplates(tRes.data.data || []);
      setGenerated(gRes.data.data || []);
    } catch {} finally { setLoading(false); }
  };
  useEffect(() => { fetch(); }, [filterType, filterClassId, filterFromDate, filterToDate]);

  const searchStudents = async () => {
    if (!form.studentSearch.trim()) return;
    const res = await api.get("/students", { params: { search: form.studentSearch, limit: 5 } });
    setStudents(res.data.data || []);
  };

  const generate = async () => {
    if (!form.templateId || !form.studentId) { alert("Select template and student"); return; }
    setGenerating(true);
    try {
      const customFieldsPayload = customFields.reduce<Record<string, string>>((acc, { key, value }) => {
        if (key.trim()) acc[key.trim()] = value;
        return acc;
      }, {});

      const res = await api.post("/communication/certificates/generate", {
        templateId: form.templateId,
        studentId: form.studentId,
        ...(form.purpose ? { purpose: form.purpose } : {}),
        ...(Object.keys(customFieldsPayload).length > 0 ? { customFields: customFieldsPayload } : {}),
      });
      alert(`Certificate generated! Serial: ${res.data.data.serialNo}`);
      setShowModal(false);
      setForm({ templateId: "", studentSearch: "", studentId: "", purpose: "" });
      setCustomFields([{ key: "", value: "" }]);
      fetch();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to generate certificate");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Award className="h-6 w-6 text-primary-600" /> Certificates</h1>
        <button onClick={() => { setForm({ templateId: "", studentSearch: "", studentId: "", purpose: "" }); setCustomFields([{ key: "", value: "" }]); setShowModal(true); }} className="btn-primary flex items-center gap-2"><Plus className="h-4 w-4" /> Generate</button>
      </div>

      {/* Templates */}
      <div className="card mb-6">
        <h3 className="font-semibold mb-3">Templates</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {templates.map(t => (
            <div key={t.id} className="bg-gray-50 p-3 rounded-lg text-center">
              <Award className="h-8 w-8 text-primary-600 mx-auto mb-2" />
              <p className="font-medium text-sm">{t.name}</p>
              <p className="text-xs text-gray-400">{t.type}</p>
            </div>
          ))}
          {templates.length === 0 && <p className="text-gray-400 text-sm col-span-4">No templates configured</p>}
        </div>
      </div>

      {/* Filters for Generated Certificates */}
      <div className="card mb-6 flex flex-wrap gap-3">
        <select className="input-field w-auto" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
          <option value="">All Types</option>
          {["TRANSFER_CERTIFICATE", "BONAFIDE", "CHARACTER", "ID_CARD", "CUSTOM"].map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
        </select>
        <select className="input-field w-auto" value={filterClassId} onChange={(e) => setFilterClassId(e.target.value)}>
          <option value="">All Classes</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input type="date" className="input-field w-auto" value={filterFromDate} onChange={(e) => setFilterFromDate(e.target.value)} title="From date" />
        <input type="date" className="input-field w-auto" value={filterToDate} onChange={(e) => setFilterToDate(e.target.value)} title="To date" />
      </div>

      {/* Generated */}
      {loading ? <div className="flex justify-center py-8"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div> : (
        <div className="card">
          <h3 className="font-semibold mb-3">Generated Certificates ({generated.length})</h3>
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-gray-50">
              <th className="px-4 py-3 text-left">Serial No</th><th className="px-4 py-3 text-left">Student</th><th className="px-4 py-3 text-left">Type</th>
              <th className="px-4 py-3 text-left">Date</th><th className="px-4 py-3 text-center">Download</th>
            </tr></thead>
            <tbody>
              {generated.map(c => (
                <tr key={c.id} className="border-b"><td className="px-4 py-3 font-mono text-xs">{c.serialNo}</td>
                  <td className="px-4 py-3">{c.student?.user?.name || "-"}</td>
                  <td className="px-4 py-3">{c.template?.name}</td>
                  <td className="px-4 py-3 text-xs">{formatDate(c.createdAt)}</td>
                  <td className="px-4 py-3 text-center">
                    <a href={resolveUploadUrl(c.pdfUrl)} target="_blank" rel="noreferrer" className="text-primary-600">
                      <FileDown className="h-4 w-4 mx-auto" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Generate Certificate">
        <div className="space-y-4">
          <div><label className="block text-sm font-medium mb-1">Template *</label>
            <select className="input-field" value={form.templateId} onChange={e => setForm({...form, templateId: e.target.value})}>
              <option value="">Select</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name} ({t.type})</option>)}
            </select>
            {selectedTemplate && !SUPPORTED_TYPES.includes(selectedTemplate.type) && selectedTemplate.type !== "CUSTOM" && (
              <p className="text-xs text-amber-600 mt-1">
                PDF generation for &quot;{selectedTemplate.type}&quot; isn&apos;t available yet - only Transfer Certificate, Bonafide, and Character certificates generate a real PDF today.
              </p>
            )}
            {isCustomType && (
              <p className="text-xs text-amber-600 mt-1">
                CUSTOM certificates need a .docx template uploaded on the Templates page first - use the Custom Fields
                below to fill in any placeholders that template needs beyond the standard student/branch fields.
              </p>
            )}
          </div>
          <div><label className="block text-sm font-medium mb-1">Student *</label>
            <div className="flex gap-2"><input className="input-field" placeholder="Search student..." value={form.studentSearch} onChange={e => setForm({...form, studentSearch: e.target.value})} onKeyDown={e => e.key === "Enter" && searchStudents()} /><button type="button" onClick={searchStudents} className="btn-secondary text-sm">Find</button></div>
            {students.length > 0 && <div className="mt-2 border rounded max-h-32 overflow-y-auto">{students.map(s => (
              <button key={s.id} onClick={() => { setForm({...form, studentId: s.id, studentSearch: s.user.name}); setStudents([]); }} className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm border-b last:border-0">{s.user.name} ({s.admissionNo})</button>
            ))}</div>}
          </div>
          {selectedTemplate?.type === "BONAFIDE" && (
            <div><label className="block text-sm font-medium mb-1">Purpose (optional)</label>
              <input className="input-field" placeholder="e.g., applying for a passport" value={form.purpose} onChange={e => setForm({...form, purpose: e.target.value})} />
            </div>
          )}
          {isCustomType && (
            <div>
              <label className="block text-sm font-medium mb-1">Custom Fields</label>
              <p className="text-xs text-gray-400 mb-2">
                Key = the placeholder name in your .docx template (without curly braces), Value = what to fill in.
              </p>
              <div className="space-y-2">
                {customFields.map((cf, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <input
                      className="input-field flex-1"
                      placeholder="e.g. eventName"
                      value={cf.key}
                      onChange={(e) => updateCustomField(idx, "key", e.target.value)}
                    />
                    <input
                      className="input-field flex-1"
                      placeholder="e.g. Annual Sports Day"
                      value={cf.value}
                      onChange={(e) => updateCustomField(idx, "value", e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => removeCustomFieldRow(idx)}
                      disabled={customFields.length === 1}
                      className="text-red-400 hover:text-red-600 disabled:opacity-30 flex-shrink-0"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={addCustomFieldRow} className="mt-2 text-xs text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1">
                <Plus className="h-3.5 w-3.5" /> Add Field
              </button>
            </div>
          )}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            <button onClick={generate} disabled={generating} className="btn-primary disabled:opacity-50">{generating ? "Generating..." : "Generate"}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
