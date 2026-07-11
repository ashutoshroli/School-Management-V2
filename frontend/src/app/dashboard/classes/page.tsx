"use client";

import { useState, useEffect } from "react";
import { School, Plus, Edit, Trash2, BookOpen, Users } from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";
import ErrorBanner from "@/components/ui/ErrorBanner";

interface Section {
  id: string;
  name: string;
  capacity: number;
  _count?: { students: number };
}

interface ClassItem {
  id: string;
  name: string;
  numericOrder: number;
  sections: Section[];
  _count?: { students: number };
}

export default function ClassesPage() {
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showClassModal, setShowClassModal] = useState(false);
  const [showSectionModal, setShowSectionModal] = useState(false);
  const [selectedClassId, setSelectedClassId] = useState("");
  // Note: branchId is deliberately NOT part of these forms - the
  // backend always scopes creation to the logged-in user's own branch
  // (see resolveEffectiveBranchId in backend/src/utils/branchScope.ts).
  const [classForm, setClassForm] = useState({ name: "", numericOrder: 0 });
  const [sectionForm, setSectionForm] = useState({ name: "", capacity: 40, classId: "" });

  const [error, setError] = useState<string | null>(null);

  const fetchClasses = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.get("/classes");
      setClasses(res.data.data || []);
    } catch (err: any) {
      console.error("Failed to fetch classes", err);
      setError(err.response?.data?.message || "Failed to load classes. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchClasses(); }, []);

  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/classes", classForm);
      setShowClassModal(false);
      setClassForm({ name: "", numericOrder: 0 });
      fetchClasses();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed");
    }
  };

  const handleCreateSection = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/classes/sections", { ...sectionForm, classId: selectedClassId });
      setShowSectionModal(false);
      setSectionForm({ name: "", capacity: 40, classId: "" });
      fetchClasses();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed");
    }
  };

  const deleteClass = async (id: string) => {
    if (!confirm("Are you sure you want to delete this class?")) return;
    try {
      await api.delete(`/classes/${id}`);
      fetchClasses();
    } catch (err: any) {
      alert(err.response?.data?.message || "Cannot delete");
    }
  };

  const deleteSection = async (id: string) => {
    if (!confirm("Delete this section?")) return;
    try {
      await api.delete(`/classes/sections/${id}`);
      fetchClasses();
    } catch (err: any) {
      alert(err.response?.data?.message || "Cannot delete");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <School className="h-6 w-6 text-primary-600" /> Classes & Sections
          </h1>
          <p className="text-gray-500 mt-1">Manage class structure</p>
        </div>
        <button onClick={() => setShowClassModal(true)} className="btn-primary flex items-center gap-2">
          <Plus className="h-4 w-4" /> Add Class
        </button>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchClasses} />}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {classes.map((cls) => (
            <div key={cls.id} className="card">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-gray-900">{cls.name}</h3>
                <div className="flex gap-1">
                  <button onClick={() => { setSelectedClassId(cls.id); setShowSectionModal(true); }} className="p-1 rounded hover:bg-gray-100" title="Add Section">
                    <Plus className="h-4 w-4 text-green-600" />
                  </button>
                  <button onClick={() => deleteClass(cls.id)} className="p-1 rounded hover:bg-gray-100" title="Delete">
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-500 mb-3">
                <Users className="h-4 w-4" />
                <span>{cls._count?.students || 0} students</span>
              </div>
              {/* Sections */}
              <div className="space-y-2">
                {cls.sections.map((sec) => (
                  <div key={sec.id} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded-lg">
                    <span className="text-sm font-medium">Section {sec.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">{sec._count?.students || 0}/{sec.capacity}</span>
                      <button onClick={() => deleteSection(sec.id)} className="text-red-400 hover:text-red-600">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
                {cls.sections.length === 0 && <p className="text-xs text-gray-400">No sections</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Class Modal */}
      <Modal isOpen={showClassModal} onClose={() => setShowClassModal(false)} title="Add New Class">
        <form onSubmit={handleCreateClass} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Class Name *</label>
            <input className="input-field" placeholder="e.g., Class 5, Nursery" value={classForm.name} onChange={(e) => setClassForm({ ...classForm, name: e.target.value })} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Order (for sorting)</label>
            <input type="number" className="input-field" value={classForm.numericOrder} onChange={(e) => setClassForm({ ...classForm, numericOrder: parseInt(e.target.value) })} />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setShowClassModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">Create Class</button>
          </div>
        </form>
      </Modal>

      {/* Add Section Modal */}
      <Modal isOpen={showSectionModal} onClose={() => setShowSectionModal(false)} title="Add Section">
        <form onSubmit={handleCreateSection} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Section Name *</label>
            <input className="input-field" placeholder="e.g., A, B, C" value={sectionForm.name} onChange={(e) => setSectionForm({ ...sectionForm, name: e.target.value })} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Capacity</label>
            <input type="number" className="input-field" value={sectionForm.capacity} onChange={(e) => setSectionForm({ ...sectionForm, capacity: parseInt(e.target.value) })} />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setShowSectionModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">Create Section</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
