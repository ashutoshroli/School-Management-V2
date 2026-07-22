"use client";

import { useState, useEffect } from "react";
import { UtensilsCrossed, Plus, ArrowRight } from "lucide-react";
import api from "@/lib/api";

const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const MEALS = ["BREAKFAST", "LUNCH", "DINNER", "SNACKS"];

/**
 * Mess Module (spec Section 14) - week-wise veg/non-veg menu with a
 * 4-stage approval chain (Incharge -> Warden -> Principal -> Director),
 * monthly-fixed billing, and guest meal logging.
 */
export default function MessPage() {
  const [menus, setMenus] = useState<any[]>([]);
  const [bills, setBills] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ dayOfWeek: "MONDAY", mealType: "LUNCH", vegOption: "", nonVegOption: "" });
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [menuRes, billRes] = await Promise.all([api.get("/mess/menu"), api.get("/mess/bills")]);
      setMenus(menuRes.data.data || []);
      setBills(billRes.data.data || []);
    } catch { setMenus([]); setBills([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const saveMenu = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/mess/menu", form);
      setShowModal(false);
      fetchData();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
    finally { setSaving(false); }
  };

  const advance = async (id: string, decision: "APPROVE" | "REJECT") => {
    try {
      await api.patch(`/mess/menu/${id}/advance`, { decision });
      fetchData();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <UtensilsCrossed className="h-6 w-6 text-primary-600" /> Mess Management
          </h1>
          <p className="text-gray-500 mt-1">Week-wise menu with approval chain, monthly billing, guest meals</p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-1.5 text-sm">
          <Plus className="h-4 w-4" /> Add/Edit Menu Item
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : (
        <>
          <h2 className="font-semibold text-gray-700 mb-2">Weekly Menu (Approval Chain: Incharge &rarr; Warden &rarr; Principal &rarr; Director)</h2>
          <div className="card overflow-x-auto mb-8">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="px-4 py-3 text-left">Day</th>
                  <th className="px-4 py-3 text-left">Meal</th>
                  <th className="px-4 py-3 text-left">Veg</th>
                  <th className="px-4 py-3 text-left">Non-Veg</th>
                  <th className="px-4 py-3 text-left">Approval Stage</th>
                  <th className="px-4 py-3 text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                {menus.map((m) => (
                  <tr key={m.id} className="border-b">
                    <td className="px-4 py-3">{m.dayOfWeek}</td>
                    <td className="px-4 py-3">{m.mealType}</td>
                    <td className="px-4 py-3">{m.vegOption}</td>
                    <td className="px-4 py-3">{m.nonVegOption || "-"}</td>
                    <td className="px-4 py-3"><span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100">{m.approvalStage}</span></td>
                    <td className="px-4 py-3">
                      {m.approvalStage !== "DIRECTOR_APPROVED" && m.approvalStage !== "REJECTED" && (
                        <button onClick={() => advance(m.id, "APPROVE")} className="text-primary-600 hover:underline text-xs font-medium flex items-center gap-1">
                          Advance <ArrowRight className="h-3 w-3" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="font-semibold text-gray-700 mb-2">Mess Bills</h2>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="px-4 py-3 text-left">Month/Year</th>
                  <th className="px-4 py-3 text-left">Amount</th>
                  <th className="px-4 py-3 text-left">Waived</th>
                  <th className="px-4 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((b) => (
                  <tr key={b.id} className="border-b">
                    <td className="px-4 py-3">{b.month}/{b.year}</td>
                    <td className="px-4 py-3">Rs {Number(b.amount).toLocaleString()}</td>
                    <td className="px-4 py-3">Rs {Number(b.waivedAmount).toLocaleString()}</td>
                    <td className="px-4 py-3"><span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100">{b.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full">
            <h2 className="text-lg font-bold mb-4">Add/Edit Menu Item</h2>
            <form onSubmit={saveMenu} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Day of Week</label>
                <select className="input-field" value={form.dayOfWeek} onChange={(e) => setForm({ ...form, dayOfWeek: e.target.value })}>
                  {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Meal Type</label>
                <select className="input-field" value={form.mealType} onChange={(e) => setForm({ ...form, mealType: e.target.value })}>
                  {MEALS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Veg Option *</label>
                <input className="input-field" value={form.vegOption} onChange={(e) => setForm({ ...form, vegOption: e.target.value })} required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Non-Veg Option</label>
                <input className="input-field" value={form.nonVegOption} onChange={(e) => setForm({ ...form, nonVegOption: e.target.value })} />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary disabled:opacity-50">{saving ? "Saving..." : "Save"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
