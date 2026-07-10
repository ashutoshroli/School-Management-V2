"use client";

import { useState, useEffect } from "react";
import { BookOpen, Plus } from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";
import { formatDate } from "@/lib/utils";

export default function HomeworkPage() {
  const [homeworks, setHomeworks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [form, setForm] = useState({ title: "", description: "", subjectId: "", classId: "", sectionId: "", dueDate: "" });

  const fetch = async () => {
    setLoading(true);
    try {
      const [hRes, sRes, cRes] = await Promise.all([
        api.get("/academics/homework"),
        api.get("/classes/subjects"),
        api.get("/classes"),
      ]);
      setHomeworks(hRes.data.data || []);
      setSubjects(sRes.data.data || []);
      setClasses(cRes.data.data || []);
    } catch {} finally { setLoading(false); }
  };
  useEffect(() => { fetch(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/academics/homework", form);
      setShowModal(false); fetch();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2"><BookOpen className="h-6 w-6 text-primary-600" /> Homework</h1>
        <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2"><Plus className="h-4 w-4" /> Assign Homework</button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : (
        <div className="space-y-3">
          {homeworks.map(h => (
            <div key={h.id} className="card flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">{h.title}</h3>
                <p className="text-sm text-gray-500">{h.subject?.name} | Due: {formatDate(h.dueDate)}</p>
                {h.description && <p className="text-xs text-gray-400 mt-1">{h.description}</p>}
              </div>
              <div className="text-right">
                <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full">{h.submissionCount || 0} submitted</span>
              </div>
            </div>
          ))}
          {homeworks.length === 0 && <p className="text-center text-gray-500 py-8">No homework assigned yet</p>}
        </div>
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Assign Homework">
        <form onSubmit={handleCreate} className="space-y-4">
          <div><label className="block text-sm font-medium mb-1">Title *</label>
            <input className="input-field" value={form.title} onChange={e => setForm({...form, title: e.target.value})} required /></div>
          <div><label className="block text-sm font-medium mb-1">Description</label>
            <textarea className="input-field" rows={3} value={form.description} onChange={e => setForm({...form, description: e.target.value})} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Class *</label>
              <select className="input-field" value={form.classId} onChange={e => setForm({...form, classId: e.target.value})} required>
                <option value="">Select</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
            <div><label className="block text-sm font-medium mb-1">Subject *</label>
              <select className="input-field" value={form.subjectId} onChange={e => setForm({...form, subjectId: e.target.value})} required>
                <option value="">Select</option>{subjects.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></div>
            <div><label className="block text-sm font-medium mb-1">Due Date *</label>
              <input type="date" className="input-field" value={form.dueDate} onChange={e => setForm({...form, dueDate: e.target.value})} required /></div>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">Assign</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
