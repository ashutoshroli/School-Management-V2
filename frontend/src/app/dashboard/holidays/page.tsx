"use client";

import { useState, useEffect } from "react";
import { CalendarDays, Plus, Trash2 } from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";
import { useAuth } from "@/hooks/useAuth";
import { formatDate } from "@/lib/utils";


interface Holiday {
  id: string;
  date: string;
  name: string;
}

export default function HolidaysPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "SUPER_ADMIN" || user?.role === "BRANCH_ADMIN";

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: "", date: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const fetchHolidays = async () => {
    setLoading(true);
    try {
      const res = await api.get("/hr/holidays", { params: { branchId: user?.branchId } });
      setHolidays(res.data.data || []);
    } catch { setHolidays([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchHolidays(); }, [user?.branchId]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.post("/hr/holidays", { ...form, branchId: user?.branchId });
      setShowModal(false);
      setForm({ name: "", date: "" });
      fetchHolidays();
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to add holiday");
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this holiday?")) return;
    try {
      await api.delete(`/hr/holidays/${id}`);
      fetchHolidays();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <CalendarDays className="h-6 w-6 text-primary-600" /> Holiday Calendar
          </h1>
          <p className="text-gray-500 mt-1">Manage branch holidays and non-working days</p>
        </div>
        {isAdmin && (
          <button onClick={() => { setError(""); setShowModal(true); }} className="btn-primary flex items-center gap-1.5 text-sm">
            <Plus className="h-4 w-4" /> Add Holiday
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
        </div>
      ) : holidays.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-500">No holidays added yet for this branch.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Holiday Name</th>
                {isAdmin && <th className="px-4 py-3 text-center w-20">Remove</th>}
              </tr>
            </thead>
            <tbody>
              {holidays.map((h) => (
                <tr key={h.id} className="border-b">
                  <td className="px-4 py-3 font-medium">{formatDate(h.date)}</td>
                  <td className="px-4 py-3">{h.name}</td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => handleDelete(h.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Add Holiday">
        <form onSubmit={handleAdd} className="space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>}
          <div>
            <label className="block text-sm font-medium mb-1">Holiday Name *</label>
            <input className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Republic Day" required />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Date *</label>
            <input type="date" className="input-field" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary disabled:opacity-50">
              {saving ? "Adding..." : "Add Holiday"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
