"use client";

import { useState, useEffect } from "react";
import { Award, Plus, FileDown } from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";
import { formatDate } from "@/lib/utils";

export default function CertificatesPage() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [generated, setGenerated] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ templateId: "", studentSearch: "", studentId: "" });
  const [students, setStudents] = useState<any[]>([]);

  const fetch = async () => {
    setLoading(true);
    try {
      const [tRes, gRes] = await Promise.all([api.get("/communication/certificates/templates"), api.get("/communication/certificates/generated")]);
      setTemplates(tRes.data.data || []);
      setGenerated(gRes.data.data || []);
    } catch {} finally { setLoading(false); }
  };
  useEffect(() => { fetch(); }, []);

  const searchStudents = async () => {
    if (!form.studentSearch.trim()) return;
    const res = await api.get("/students", { params: { search: form.studentSearch, limit: 5 } });
    setStudents(res.data.data || []);
  };

  const generate = async () => {
    if (!form.templateId || !form.studentId) { alert("Select template and student"); return; }
    try {
      const res = await api.post("/communication/certificates/generate", { templateId: form.templateId, studentId: form.studentId });
      alert(`Certificate generated! Serial: ${res.data.data.serialNo}`);
      setShowModal(false); fetch();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Award className="h-6 w-6 text-primary-600" /> Certificates</h1>
        <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2"><Plus className="h-4 w-4" /> Generate</button>
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

      {/* Generated */}
      {loading ? <div className="flex justify-center py-8"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div> : (
        <div className="card">
          <h3 className="font-semibold mb-3">Generated Certificates ({generated.length})</h3>
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-gray-50">
              <th className="px-4 py-3 text-left">Serial No</th><th className="px-4 py-3 text-left">Type</th>
              <th className="px-4 py-3 text-left">Date</th><th className="px-4 py-3 text-center">Download</th>
            </tr></thead>
            <tbody>
              {generated.map(c => (
                <tr key={c.id} className="border-b"><td className="px-4 py-3 font-mono text-xs">{c.serialNo}</td>
                  <td className="px-4 py-3">{c.template?.name}</td>
                  <td className="px-4 py-3 text-xs">{formatDate(c.createdAt)}</td>
                  <td className="px-4 py-3 text-center"><a href={c.pdfUrl} className="text-primary-600"><FileDown className="h-4 w-4 mx-auto" /></a></td>
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
            </select></div>
          <div><label className="block text-sm font-medium mb-1">Student *</label>
            <div className="flex gap-2"><input className="input-field" placeholder="Search student..." value={form.studentSearch} onChange={e => setForm({...form, studentSearch: e.target.value})} onKeyDown={e => e.key === "Enter" && searchStudents()} /><button type="button" onClick={searchStudents} className="btn-secondary text-sm">Find</button></div>
            {students.length > 0 && <div className="mt-2 border rounded max-h-32 overflow-y-auto">{students.map(s => (
              <button key={s.id} onClick={() => { setForm({...form, studentId: s.id, studentSearch: s.user.name}); setStudents([]); }} className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm border-b last:border-0">{s.user.name} ({s.admissionNo})</button>
            ))}</div>}
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t"><button onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button><button onClick={generate} className="btn-primary">Generate</button></div>
        </div>
      </Modal>
    </div>
  );
}
