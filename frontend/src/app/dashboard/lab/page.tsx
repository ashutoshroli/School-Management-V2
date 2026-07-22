"use client";

import { useState, useEffect } from "react";
import { FlaskConical, Plus, AlertTriangle } from "lucide-react";
import api from "@/lib/api";

/**
 * Lab Management Module (spec Section 16) - equipment issue
 * (group/individual), damage/breakage fine (Principal-waivable), and
 * chemical/consumable expiry alerts.
 */
export default function LabPage() {
  const [equipment, setEquipment] = useState<any[]>([]);
  const [expiring, setExpiring] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: "", category: "", totalQuantity: "1", isConsumable: false, expiryDate: "" });
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [eqRes, expRes] = await Promise.all([api.get("/lab/equipment"), api.get("/lab/equipment/expiring")]);
      setEquipment(eqRes.data.data || []);
      setExpiring(expRes.data.data || []);
    } catch { setEquipment([]); setExpiring([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const addEquipment = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/lab/equipment", { ...form, totalQuantity: Number(form.totalQuantity) });
      setShowModal(false);
      setForm({ name: "", category: "", totalQuantity: "1", isConsumable: false, expiryDate: "" });
      fetchData();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FlaskConical className="h-6 w-6 text-primary-600" /> Lab Management
          </h1>
          <p className="text-gray-500 mt-1">Equipment issue (group/individual), damage fines, chemical expiry alerts</p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-1.5 text-sm">
          <Plus className="h-4 w-4" /> Add Equipment
        </button>
      </div>

      {expiring.length > 0 && (
        <div className="card bg-amber-50 border-amber-200 mb-6">
          <div className="flex items-center gap-2 text-amber-800 font-medium mb-2"><AlertTriangle className="h-4 w-4" /> Expiring/Expired Consumables</div>
          <ul className="text-sm text-amber-700 space-y-1">
            {expiring.map((e) => <li key={e.id}>{e.name} - expires {new Date(e.expiryDate).toLocaleDateString()}</li>)}
          </ul>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Category</th>
                <th className="px-4 py-3 text-left">Available/Total</th>
                <th className="px-4 py-3 text-left">Consumable</th>
              </tr>
            </thead>
            <tbody>
              {equipment.map((e) => (
                <tr key={e.id} className="border-b">
                  <td className="px-4 py-3">{e.name}</td>
                  <td className="px-4 py-3">{e.category}</td>
                  <td className="px-4 py-3">{e.availableQuantity}/{e.totalQuantity}</td>
                  <td className="px-4 py-3">{e.isConsumable ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full">
            <h2 className="text-lg font-bold mb-4">Add Lab Equipment</h2>
            <form onSubmit={addEquipment} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name *</label>
                <input className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Category</label>
                <input className="input-field" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Physics, Chemistry, Biology, Computer" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Total Quantity</label>
                <input type="number" className="input-field" value={form.totalQuantity} onChange={(e) => setForm({ ...form, totalQuantity: e.target.value })} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.isConsumable} onChange={(e) => setForm({ ...form, isConsumable: e.target.checked })} />
                Consumable/Chemical (tracks expiry)
              </label>
              {form.isConsumable && (
                <div>
                  <label className="block text-sm font-medium mb-1">Expiry Date</label>
                  <input type="date" className="input-field" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary disabled:opacity-50">{saving ? "Saving..." : "Add"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
