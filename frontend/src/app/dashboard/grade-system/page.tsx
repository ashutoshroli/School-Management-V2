"use client";

import { useState, useEffect } from "react";
import { Award, Plus, Trash2, Pencil } from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";
import { useAuth } from "@/hooks/useAuth";


interface GradeBand {
  id: string;
  name: string;
  minMarks: number;
  maxMarks: number;
  grade: string;
  gradePoint: number | null;
}

export default function GradeSystemPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "SUPER_ADMIN" || user?.role === "BRANCH_ADMIN";

  const [bands, setBands] = useState<GradeBand[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<GradeBand | null>(null);
  const [form, setForm] = useState({ name: "", minMarks: "", maxMarks: "", grade: "", gradePoint: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");


  const fetchBands = async () => {
    setLoading(true);
    try {
      const res = await api.get("/academics/grade-system");
      setBands(res.data.data || []);
    } catch { setBands([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchBands(); }, []);

  const openAdd = () => {
    setEditing(null);
    setForm({ name: "", minMarks: "", maxMarks: "", grade: "", gradePoint: "" });
    setError("");
    setShowModal(true);
  };

  const openEdit = (b: GradeBand) => {
    setEditing(b);
    setForm({
      name: b.name,
      minMarks: String(b.minMarks),
      maxMarks: String(b.maxMarks),
      grade: b.grade,
      gradePoint: b.gradePoint != null ? String(b.gradePoint) : "",
    });
    setError("");
    setShowModal(true);
  };


  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    const payload = {
      name: form.name,
      minMarks: parseFloat(form.minMarks),
      maxMarks: parseFloat(form.maxMarks),
      grade: form.grade,
      gradePoint: form.gradePoint ? parseFloat(form.gradePoint) : null,
    };
    try {
      if (editing) {
        await api.put(`/academics/grade-system/${editing.id}`, payload);
      } else {
        await api.post("/academics/grade-system", payload);
      }
      setShowModal(false);
      fetchBands();
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to save");
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this grade band?")) return;
    try {
      await api.delete(`/academics/grade-system/${id}`);
      fetchBands();
    } catch (err: any) { alert(err.response?.data?.message || "Failed to delete"); }
  };


  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Award className="h-6 w-6 text-primary-600" /> Grade System
          </h1>
          <p className="text-gray-500 mt-1">Configure grading scale bands (e.g. CBSE A1/A2/B1...)</p>
        </div>
        {isAdmin && (
          <button onClick={openAdd} className="btn-primary flex items-center gap-1.5 text-sm">
            <Plus className="h-4 w-4" /> Add Grade Band
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
        </div>
      ) : bands.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-500">No grade bands configured yet.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-center">Grade</th>
                <th className="px-4 py-3 text-center">Min Marks</th>
                <th className="px-4 py-3 text-center">Max Marks</th>
                <th className="px-4 py-3 text-center">Grade Point</th>
                {isAdmin && <th className="px-4 py-3 text-center">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {bands.map((b) => (
                <tr key={b.id} className="border-b">
                  <td className="px-4 py-3 font-medium">{b.name}</td>
                  <td className="px-4 py-3 text-center font-bold text-primary-700">{b.grade}</td>
                  <td className="px-4 py-3 text-center">{b.minMarks}</td>
                  <td className="px-4 py-3 text-center">{b.maxMarks}</td>
                  <td className="px-4 py-3 text-center">{b.gradePoint ?? "-"}</td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-center">
                      <div className="flex justify-center gap-2">
                        <button onClick={() => openEdit(b)} className="text-primary-600 hover:text-primary-700">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button onClick={() => handleDelete(b.id)} className="text-red-500 hover:text-red-700">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}


      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editing ? "Edit Grade Band" : "Add Grade Band"}>
        <form onSubmit={handleSave} className="space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>}
          <div>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. CBSE Grading" required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Grade *</label>
              <input className="input-field" value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} placeholder="e.g. A1" required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Grade Point</label>
              <input type="number" step="0.1" className="input-field" value={form.gradePoint} onChange={(e) => setForm({ ...form, gradePoint: e.target.value })} placeholder="e.g. 10" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Min Marks *</label>
              <input type="number" step="0.01" className="input-field" value={form.minMarks} onChange={(e) => setForm({ ...form, minMarks: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Max Marks *</label>
              <input type="number" step="0.01" className="input-field" value={form.maxMarks} onChange={(e) => setForm({ ...form, maxMarks: e.target.value })} required />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary disabled:opacity-50">
              {saving ? "Saving..." : editing ? "Save Changes" : "Create"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
