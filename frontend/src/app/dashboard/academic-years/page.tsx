"use client";

import { useState, useEffect } from "react";
import { Calendar, Plus, Check } from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";
import ErrorBanner from "@/components/ui/ErrorBanner";
import { formatDate } from "@/lib/utils";

interface AcademicYear {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
}

export default function AcademicYearsPage() {
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  // Note: branchId is deliberately NOT part of this form - the backend
  // always scopes creation to the logged-in user's own branch (see
  // resolveEffectiveBranchId in backend/src/utils/branchScope.ts). This
  // form previously sent an always-empty branchId field, which caused
  // every creation to fail (403/500) until that backend fallback was added.
  const [form, setForm] = useState({ name: "", startDate: "", endDate: "" });

  const [error, setError] = useState<string | null>(null);

  const fetchYears = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.get("/academic-years");
      setYears(res.data.data || []);
    } catch (err: any) {
      console.error("Failed to fetch academic years", err);
      setError(err.response?.data?.message || "Failed to load academic years. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchYears(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/academic-years", form);
      setShowModal(false);
      setForm({ name: "", startDate: "", endDate: "" });
      fetchYears();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to create");
    }
  };

  const setActive = async (id: string) => {
    try {
      await api.patch(`/academic-years/${id}/activate`);
      fetchYears();
    } catch (err) {
      alert("Failed to activate");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Calendar className="h-6 w-6 text-primary-600" /> Academic Years
          </h1>
          <p className="text-gray-500 mt-1">Manage academic sessions</p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2">
          <Plus className="h-4 w-4" /> Add Year
        </button>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchYears} />}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-3 flex justify-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
          </div>
        ) : years.length === 0 ? (
          <p className="col-span-3 text-center text-gray-500 py-12">No academic years found</p>
        ) : (
          years.map((year) => (
            <div key={year.id} className={`card border-2 ${year.isActive ? "border-green-400" : "border-gray-100"}`}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-bold text-gray-900">{year.name}</h3>
                {year.isActive && (
                  <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded-full">Active</span>
                )}
              </div>
              <p className="text-sm text-gray-500">
                {formatDate(year.startDate)} — {formatDate(year.endDate)}
              </p>
              {!year.isActive && (
                <button onClick={() => setActive(year.id)} className="mt-3 text-sm text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1">
                  <Check className="h-4 w-4" /> Set as Active
                </button>
              )}
            </div>
          ))
        )}
      </div>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Create Academic Year">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Year Name *</label>
            <input className="input-field" placeholder="e.g., 2025-26" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Date *</label>
              <input type="date" className="input-field" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Date *</label>
              <input type="date" className="input-field" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} required />
            </div>
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
