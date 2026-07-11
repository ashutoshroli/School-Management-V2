"use client";

import { useState, useEffect } from "react";
import { Tag, Plus, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";

interface Category {
  id: string;
  name: string;
  code: string;
  isSystem: boolean;
  isActive: boolean;
}

export default function FeeCategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  // Note: branchId is deliberately NOT part of this form - the backend
  // always scopes creation to the logged-in user's own branch.
  const [form, setForm] = useState({ name: "", code: "" });

  const fetch = async () => {
    try {
      setLoading(true);
      const res = await api.get("/fees/categories");
      setCategories(res.data.data || []);
    } catch (err) {} finally { setLoading(false); }
  };

  useEffect(() => { fetch(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/fees/categories", form);
      setShowModal(false);
      setForm({ name: "", code: "" });
      fetch();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  const toggle = async (id: string) => {
    await api.patch(`/fees/categories/${id}/toggle`);
    fetch();
  };

  const deleteCategory = async (id: string, name: string) => {
    if (!confirm(`Delete fee category "${name}"?`)) return;
    try {
      await api.delete(`/fees/categories/${id}`);
      fetch();
    } catch (err: any) { alert(err.response?.data?.message || "Cannot delete this category"); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Tag className="h-6 w-6 text-primary-600" /> Fee Categories
          </h1>
          <p className="text-gray-500 mt-1">System + custom fee categories</p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2">
          <Plus className="h-4 w-4" /> Add Custom
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {categories.map((cat) => (
            <div key={cat.id} className={`card flex items-center justify-between ${!cat.isActive ? "opacity-60" : ""}`}>
              <div>
                <h3 className="font-semibold text-gray-900">{cat.name}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs font-mono text-gray-500">{cat.code}</span>
                  {cat.isSystem && <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">System</span>}
                  {!cat.isSystem && <span className="text-xs px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full">Custom</span>}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => toggle(cat.id)} className="p-1" title={cat.isActive ? "Deactivate" : "Activate"}>
                  {cat.isActive ? <ToggleRight className="h-6 w-6 text-green-600" /> : <ToggleLeft className="h-6 w-6 text-gray-400" />}
                </button>
                {!cat.isSystem && (
                  <button onClick={() => deleteCategory(cat.id, cat.name)} className="p-1" title="Delete">
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Add Custom Fee Category">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category Name *</label>
            <input className="input-field" placeholder="e.g., Activity Fee" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Code *</label>
            <input className="input-field" placeholder="e.g., ACTIVITY" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} required />
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
