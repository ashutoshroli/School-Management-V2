"use client";

import { useState, useEffect } from "react";
import { BookOpen, Plus, Edit, Trash2, Eye, Users } from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";
import ErrorBanner from "@/components/ui/ErrorBanner";

interface Subject {
  id: string;
  name: string;
  code: string;
  type: "THEORY" | "PRACTICAL" | "ELECTIVE";
}

const SUBJECT_TYPES: Subject["type"][] = ["THEORY", "PRACTICAL", "ELECTIVE"];

const EMPTY_FORM = { name: "", code: "", type: "THEORY" as Subject["type"] };

export default function SubjectsPage() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const fetchSubjects = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.get("/classes/subjects");
      setSubjects(res.data.data || []);
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to load subjects. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSubjects(); }, []);

  const openCreateModal = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const openEditModal = (subject: Subject) => {
    setEditingId(subject.id);
    setForm({ name: subject.name, code: subject.code, type: subject.type });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        await api.put(`/classes/subjects/${editingId}`, form);
      } else {
        // Note: branchId is deliberately NOT part of this form - the
        // backend always scopes creation to the logged-in user's own
        // branch (see resolveEffectiveBranchId in
        // backend/src/utils/branchScope.ts).
        await api.post("/classes/subjects", form);
      }
      setShowModal(false);
      fetchSubjects();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to save subject");
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete subject "${name}"?`)) return;
    try {
      await api.delete(`/classes/subjects/${id}`);
      fetchSubjects();
    } catch (err: any) {
      alert(err.response?.data?.message || "Cannot delete this subject");
    }
  };

  // Bulk Assign to Classes - "Science for Classes 6-10 in one call",
  // via the new bulkAssignSubjectToClass endpoint (assignSubjectToClass
  // only ever handled one class at a time before).
  const [bulkSubject, setBulkSubject] = useState<Subject | null>(null);
  const [allClasses, setAllClasses] = useState<any[]>([]);
  const [bulkSelectedClassIds, setBulkSelectedClassIds] = useState<string[]>([]);
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [bulkAssignResult, setBulkAssignResult] = useState<{ assigned: number; skipped: number } | null>(null);

  useEffect(() => {
    api.get("/classes").then((res) => setAllClasses(res.data.data || [])).catch(() => {});
  }, []);

  const openBulkAssign = (subject: Subject) => {
    setBulkSubject(subject);
    setBulkSelectedClassIds([]);
    setBulkAssignResult(null);
  };

  const toggleBulkClass = (classId: string) => {
    setBulkSelectedClassIds((prev) => (prev.includes(classId) ? prev.filter((id) => id !== classId) : [...prev, classId]));
  };

  const handleBulkAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkSubject || bulkSelectedClassIds.length === 0) return;
    setBulkAssigning(true);
    try {
      const res = await api.post("/classes/subjects/assign/bulk", { subjectId: bulkSubject.id, classIds: bulkSelectedClassIds });
      setBulkAssignResult(res.data.data);
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to bulk-assign subject to classes");
    } finally {
      setBulkAssigning(false);
    }
  };

  // View Details - drills into the classes/teachers using this
  // subject via the new getSubjectById endpoint.
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const openDetail = async (id: string) => {
    setDetail({});
    setDetailLoading(true);
    try {
      const res = await api.get(`/classes/subjects/${id}`);
      setDetail(res.data.data);
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to load subject details");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary-600" /> Subjects
          </h1>
          <p className="text-gray-500 mt-1">Manage subjects taught across classes</p>
        </div>
        <button onClick={openCreateModal} className="btn-primary flex items-center gap-2">
          <Plus className="h-4 w-4" /> Add Subject
        </button>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchSubjects} />}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="overflow-x-auto card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="px-4 py-3 text-left font-medium text-gray-600">Name</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Code</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Type</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {subjects.map((s) => (
                <tr key={s.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{s.name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{s.code}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">{s.type}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <button onClick={() => openDetail(s.id)} title="View Details" className="text-gray-500 hover:text-gray-700">
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => openBulkAssign(s)} title="Bulk Assign to Classes" className="text-primary-600 hover:text-primary-700">
                        <Users className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => openEditModal(s)} title="Edit" className="text-gray-500 hover:text-gray-700">
                        <Edit className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => handleDelete(s.id, s.name)} title="Delete" className="text-red-500 hover:text-red-700">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {subjects.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500">No subjects found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editingId ? "Edit Subject" : "Add Subject"}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Subject Name *</label>
            <input className="input-field" placeholder="e.g., Mathematics" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Code *</label>
            <input className="input-field" placeholder="e.g., MATH01" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <select className="input-field" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as Subject["type"] })}>
              {SUBJECT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">{editingId ? "Save Changes" : "Create"}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!detail} onClose={() => setDetail(null)} title={detail?.name ? `Subject - ${detail.name}` : "Subject Details"}>
        {detailLoading ? (
          <div className="flex justify-center py-8"><div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
        ) : detail ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-gray-500">Code</p><p className="font-medium font-mono">{detail.code}</p></div>
              <div><p className="text-gray-500">Type</p><p className="font-medium">{detail.type}</p></div>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-gray-600 mb-2">Assigned to Classes</h4>
              {detail.classSubjects?.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {detail.classSubjects.map((cs: any) => (
                    <span key={cs.class.id} className="text-xs px-2 py-1 bg-gray-100 rounded-full">{cs.class.name}</span>
                  ))}
                </div>
              ) : <p className="text-sm text-gray-400">Not assigned to any class yet.</p>}
            </div>
            <div>
              <h4 className="text-sm font-semibold text-gray-600 mb-2">Teachers</h4>
              {detail.subjectTeachers?.length > 0 ? (
                <div className="space-y-1.5">
                  {detail.subjectTeachers.map((st: any, idx: number) => (
                    <div key={idx} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded-lg text-sm">
                      <span>{st.staff?.user?.name}</span>
                      <span className="text-xs text-gray-500">{st.class?.name || "All classes"}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-gray-400">No teacher assigned yet.</p>}
            </div>
            <div className="flex justify-end pt-2 border-t">
              <button type="button" onClick={() => setDetail(null)} className="btn-secondary">Close</button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal isOpen={!!bulkSubject} onClose={() => setBulkSubject(null)} title={bulkSubject ? `Bulk Assign - ${bulkSubject.name}` : "Bulk Assign"}>
        <form onSubmit={handleBulkAssign} className="space-y-4">
          <p className="text-xs text-gray-400">Select every class that should have this subject.</p>
          {bulkAssignResult && (
            <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-3 py-2">
              Assigned to {bulkAssignResult.assigned} class(es){bulkAssignResult.skipped > 0 ? `, ${bulkAssignResult.skipped} already had it` : ""}.
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
            {allClasses.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm px-2 py-1.5 border rounded-lg hover:bg-gray-50">
                <input type="checkbox" checked={bulkSelectedClassIds.includes(c.id)} onChange={() => toggleBulkClass(c.id)} />
                {c.name}
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t">
            <button type="button" onClick={() => setBulkSubject(null)} className="btn-secondary">Close</button>
            <button type="submit" disabled={bulkAssigning || bulkSelectedClassIds.length === 0} className="btn-primary disabled:opacity-50">
              {bulkAssigning ? "Assigning..." : `Assign to ${bulkSelectedClassIds.length} Class(es)`}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
