"use client";

import { useState, useEffect } from "react";
import { BookOpen, Plus, Edit, Trash2 } from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";
import { formatDate } from "@/lib/utils";

const EMPTY_FORM = { title: "", description: "", subjectId: "", classId: "", sectionId: "", dueDate: "" };

export default function HomeworkPage() {
  const [homeworks, setHomeworks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);

  // View Details - drills into one homework's full submission list via
  // the new getHomeworkById endpoint (the list view only shows a
  // submission COUNT, not who submitted/when/grade).
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const openDetail = async (id: string) => {
    setDetail({});
    setDetailLoading(true);
    try {
      const res = await api.get(`/academics/homework/${id}`);
      setDetail(res.data.data);
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to load homework details");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

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

  const openCreateModal = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const openEditModal = (h: any) => {
    setEditingId(h.id);
    setForm({
      title: h.title,
      description: h.description || "",
      subjectId: h.subjectId,
      classId: h.classId,
      sectionId: h.sectionId || "",
      dueDate: h.dueDate ? new Date(h.dueDate).toISOString().slice(0, 10) : "",
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        // classId/subjectId/sectionId aren't editable server-side (see
        // homework.controller.ts's updateHomework) - only send the
        // fields it actually supports.
        await api.put(`/academics/homework/${editingId}`, {
          title: form.title,
          description: form.description,
          dueDate: form.dueDate,
        });
      } else {
        await api.post("/academics/homework", form);
      }
      setShowModal(false); fetch();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`Delete homework "${title}"? This will also remove any student submissions.`)) return;
    try {
      await api.delete(`/academics/homework/${id}`);
      fetch();
    } catch (err: any) { alert(err.response?.data?.message || "Failed to delete homework"); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2"><BookOpen className="h-6 w-6 text-primary-600" /> Homework</h1>
        <button onClick={openCreateModal} className="btn-primary flex items-center gap-2"><Plus className="h-4 w-4" /> Assign Homework</button>
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
              <div className="flex items-center gap-3">
                <button onClick={() => openDetail(h.id)} className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full hover:bg-blue-200">{h.submissionCount || 0} submitted</button>
                <button onClick={() => openEditModal(h)} title="Edit" className="text-gray-500 hover:text-gray-700">
                  <Edit className="h-4 w-4" />
                </button>
                <button onClick={() => handleDelete(h.id, h.title)} title="Delete" className="text-red-500 hover:text-red-700">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
          {homeworks.length === 0 && <p className="text-center text-gray-500 py-8">No homework assigned yet</p>}
        </div>
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editingId ? "Edit Homework" : "Assign Homework"}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div><label className="block text-sm font-medium mb-1">Title *</label>
            <input className="input-field" value={form.title} onChange={e => setForm({...form, title: e.target.value})} required /></div>
          <div><label className="block text-sm font-medium mb-1">Description</label>
            <textarea className="input-field" rows={3} value={form.description} onChange={e => setForm({...form, description: e.target.value})} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Class *</label>
              <select className="input-field" value={form.classId} onChange={e => setForm({...form, classId: e.target.value})} required disabled={!!editingId}>
                <option value="">Select</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
            <div><label className="block text-sm font-medium mb-1">Subject *</label>
              <select className="input-field" value={form.subjectId} onChange={e => setForm({...form, subjectId: e.target.value})} required disabled={!!editingId}>
                <option value="">Select</option>{subjects.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></div>
            <div><label className="block text-sm font-medium mb-1">Due Date *</label>
              <input type="date" className="input-field" value={form.dueDate} onChange={e => setForm({...form, dueDate: e.target.value})} required /></div>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">{editingId ? "Save Changes" : "Assign"}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!detail} onClose={() => setDetail(null)} title={detail?.title ? `Homework - ${detail.title}` : "Homework Details"}>
        {detailLoading ? (
          <div className="flex justify-center py-8"><div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
        ) : detail ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-gray-500">Subject</p><p className="font-medium">{detail.subject?.name}</p></div>
              <div><p className="text-gray-500">Class</p><p className="font-medium">{detail.class?.name}</p></div>
              <div><p className="text-gray-500">Due Date</p><p className="font-medium">{formatDate(detail.dueDate)}</p></div>
              <div><p className="text-gray-500">Submissions</p><p className="font-medium">{detail.submissions?.length || 0}</p></div>
            </div>
            {detail.description && <p className="text-sm text-gray-600">{detail.description}</p>}
            <div>
              <h4 className="text-sm font-semibold text-gray-600 mb-2">Submissions</h4>
              {detail.submissions?.length > 0 ? (
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {detail.submissions.map((s: any) => (
                    <div key={s.id} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded-lg text-sm">
                      <span>{s.student?.user?.name}</span>
                      <span className="text-xs text-gray-500">{formatDate(s.submittedAt)}{s.grade ? ` - Grade: ${s.grade}` : ""}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">No submissions yet.</p>
              )}
            </div>
            <div className="flex justify-end pt-2 border-t">
              <button type="button" onClick={() => setDetail(null)} className="btn-secondary">Close</button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
