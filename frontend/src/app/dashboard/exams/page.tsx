"use client";

import { useState, useEffect } from "react";
import { FileText, Plus, Eye, Upload } from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";
import { formatDate } from "@/lib/utils";

export default function ExamsPage() {
  const [exams, setExams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [classes, setClasses] = useState<any[]>([]);
  const [years, setYears] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", type: "UNIT_TEST", classId: "", academicYearId: "", startDate: "", endDate: "" });

  const fetch = async () => {
    setLoading(true);
    try {
      const [eRes, cRes, yRes] = await Promise.all([
        api.get("/academics/exams"), api.get("/classes"), api.get("/academic-years")
      ]);
      setExams(eRes.data.data || []);
      setClasses(cRes.data.data || []);
      setYears(yRes.data.data || []);
    } catch {} finally { setLoading(false); }
  };
  useEffect(() => { fetch(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/academics/exams", form);
      setShowModal(false); fetch();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  const togglePublish = async (id: string) => {
    await api.patch(`/academics/exams/${id}/publish`);
    fetch();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2"><FileText className="h-6 w-6 text-primary-600" /> Exams</h1>
        <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2"><Plus className="h-4 w-4" /> Create Exam</button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-gray-50">
              <th className="px-4 py-3 text-left">Exam Name</th>
              <th className="px-4 py-3 text-left">Type</th>
              <th className="px-4 py-3 text-left">Class</th>
              <th className="px-4 py-3 text-left">Date</th>
              <th className="px-4 py-3 text-center">Published</th>
              <th className="px-4 py-3 text-center">Actions</th>
            </tr></thead>
            <tbody>
              {exams.map(e => (
                <tr key={e.id} className="border-b">
                  <td className="px-4 py-3 font-medium">{e.name}</td>
                  <td className="px-4 py-3"><span className="px-2 py-0.5 bg-gray-100 rounded text-xs">{e.type}</span></td>
                  <td className="px-4 py-3">{e.class?.name}</td>
                  <td className="px-4 py-3 text-xs">{e.startDate ? formatDate(e.startDate) : "-"}</td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => togglePublish(e.id)} className={`px-2 py-0.5 rounded-full text-xs ${e.isPublished ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                      {e.isPublished ? "Published" : "Draft"}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <a href={`/dashboard/exams/${e.id}/results`} className="text-primary-600 text-xs font-medium hover:underline">Results</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Create Exam">
        <form onSubmit={handleCreate} className="space-y-4">
          <div><label className="block text-sm font-medium mb-1">Exam Name *</label>
            <input className="input-field" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Type</label>
              <select className="input-field" value={form.type} onChange={e => setForm({...form, type: e.target.value})}>
                <option value="UNIT_TEST">Unit Test</option><option value="HALF_YEARLY">Half Yearly</option>
                <option value="ANNUAL">Annual</option><option value="PRE_BOARD">Pre-Board</option>
              </select></div>
            <div><label className="block text-sm font-medium mb-1">Class *</label>
              <select className="input-field" value={form.classId} onChange={e => setForm({...form, classId: e.target.value})} required>
                <option value="">Select</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
            <div><label className="block text-sm font-medium mb-1">Academic Year *</label>
              <select className="input-field" value={form.academicYearId} onChange={e => setForm({...form, academicYearId: e.target.value})} required>
                <option value="">Select</option>{years.map(y => <option key={y.id} value={y.id}>{y.name}</option>)}
              </select></div>
            <div><label className="block text-sm font-medium mb-1">Start Date</label>
              <input type="date" className="input-field" value={form.startDate} onChange={e => setForm({...form, startDate: e.target.value})} /></div>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">Create</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
