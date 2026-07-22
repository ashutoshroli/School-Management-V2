"use client";

import { useState, useEffect } from "react";
import { Coffee, Plus, Wallet } from "lucide-react";
import api from "@/lib/api";

/**
 * Canteen Module (spec Section 15) - stock inventory, prepaid wallet +
 * cash billing, wallet recharge, stock-replenish approval chain.
 */
export default function CanteenPage() {
  const [items, setItems] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showItemModal, setShowItemModal] = useState(false);
  const [itemForm, setItemForm] = useState({ name: "", category: "", unit: "pcs", price: "", minStock: "5" });
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [itemsRes, reqRes] = await Promise.all([api.get("/canteen/items"), api.get("/canteen/stock-requests")]);
      setItems(itemsRes.data.data || []);
      setRequests(reqRes.data.data || []);
    } catch { setItems([]); setRequests([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const addItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/canteen/items", { ...itemForm, price: Number(itemForm.price), minStock: Number(itemForm.minStock) });
      setShowItemModal(false);
      setItemForm({ name: "", category: "", unit: "pcs", price: "", minStock: "5" });
      fetchData();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
    finally { setSaving(false); }
  };

  const advanceRequest = async (id: string) => {
    try {
      await api.patch(`/canteen/stock-requests/${id}/advance`, { decision: "APPROVE" });
      fetchData();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Coffee className="h-6 w-6 text-primary-600" /> Canteen Management
          </h1>
          <p className="text-gray-500 mt-1">Stock, prepaid wallet + cash billing, stock replenish approval chain</p>
        </div>
        <button onClick={() => setShowItemModal(true)} className="btn-primary flex items-center gap-1.5 text-sm">
          <Plus className="h-4 w-4" /> Add Item
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : (
        <>
          <div className="card overflow-x-auto mb-8">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="px-4 py-3 text-left">Item</th>
                  <th className="px-4 py-3 text-left">Category</th>
                  <th className="px-4 py-3 text-left">Stock</th>
                  <th className="px-4 py-3 text-left">Price</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className={`border-b ${i.currentStock <= i.minStock ? "bg-red-50" : ""}`}>
                    <td className="px-4 py-3">{i.name}</td>
                    <td className="px-4 py-3">{i.category}</td>
                    <td className="px-4 py-3">{i.currentStock} {i.unit}</td>
                    <td className="px-4 py-3">Rs {Number(i.price).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="font-semibold text-gray-700 mb-2 flex items-center gap-2"><Wallet className="h-4 w-4" /> Stock Replenish Requests</h2>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="px-4 py-3 text-left">Item</th>
                  <th className="px-4 py-3 text-left">Vendor</th>
                  <th className="px-4 py-3 text-left">Qty</th>
                  <th className="px-4 py-3 text-left">Stage</th>
                  <th className="px-4 py-3 text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id} className="border-b">
                    <td className="px-4 py-3">{r.item?.name}</td>
                    <td className="px-4 py-3">{r.vendor}</td>
                    <td className="px-4 py-3">{r.quantity}</td>
                    <td className="px-4 py-3"><span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100">{r.stage}</span></td>
                    <td className="px-4 py-3">
                      {r.stage !== "DIRECTOR_APPROVED" && r.stage !== "REJECTED" && (
                        <button onClick={() => advanceRequest(r.id)} className="text-primary-600 hover:underline text-xs font-medium">Advance</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showItemModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full">
            <h2 className="text-lg font-bold mb-4">Add Canteen Item</h2>
            <form onSubmit={addItem} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name *</label>
                <input className="input-field" value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Category</label>
                <input className="input-field" value={itemForm.category} onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Unit</label>
                <input className="input-field" value={itemForm.unit} onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Price *</label>
                <input type="number" className="input-field" value={itemForm.price} onChange={(e) => setItemForm({ ...itemForm, price: e.target.value })} required />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowItemModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary disabled:opacity-50">{saving ? "Saving..." : "Add"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
