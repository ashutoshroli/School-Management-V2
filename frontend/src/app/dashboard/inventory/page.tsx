"use client";

import { useState, useEffect } from "react";
import { Package, Plus, AlertTriangle, Trash2, Eye } from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";

export default function InventoryPage() {
  const [items, setItems] = useState<any[]>([]);
  const [lowStock, setLowStock] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState<"item" | "purchase" | "issue">("item");
  const [form, setForm] = useState<any>({ name: "", category: "", unit: "pcs", minStock: "5" });
  const [dismissedAlert, setDismissedAlert] = useState(false);

  // View Details - drills into one item's purchase/issue history via
  // the new getItemById endpoint (the list view only shows counts).
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const openDetail = async (id: string) => {
    setDetail({});
    setDetailLoading(true);
    try {
      const res = await api.get(`/facilities/inventory/items/${id}`);
      setDetail(res.data.data);
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to load item details");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const fetch = async () => {
    setLoading(true);
    try {
      const [itemsRes, lowStockRes] = await Promise.all([
        api.get("/facilities/inventory/items"),
        api.get("/facilities/inventory/low-stock"),
      ]);
      setItems(itemsRes.data.data || []);
      setLowStock(lowStockRes.data.data || []);
    }
    catch {} finally { setLoading(false); }
  };
  useEffect(() => { fetch(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (modalType === "item") await api.post("/facilities/inventory/items", { ...form, minStock: parseInt(form.minStock) });
      else if (modalType === "purchase") await api.post("/facilities/inventory/purchase", { ...form, quantity: parseInt(form.quantity), rate: parseFloat(form.rate) });
      else await api.post("/facilities/inventory/issue", { ...form, quantity: parseInt(form.quantity) });
      setShowModal(false); fetch();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  const deleteItem = async (id: string, name: string) => {
    if (!confirm(`Delete item "${name}"? This will also remove its purchase/issue history.`)) return;
    try {
      await api.delete(`/facilities/inventory/items/${id}`);
      fetch();
    } catch (err: any) { alert(err.response?.data?.message || "Cannot delete this item"); }
  };

  const openModal = (type: "item" | "purchase" | "issue") => {
    setModalType(type);
    // Note: branchId is deliberately NOT part of this form - the
    // backend always scopes creation to the logged-in user's own branch.
    if (type === "item") setForm({ name: "", category: "", unit: "pcs", minStock: "5" });
    else if (type === "purchase") setForm({ itemId: "", vendor: "", quantity: "", rate: "", billNo: "" });
    else setForm({ itemId: "", issuedTo: "", quantity: "", purpose: "" });
    setShowModal(true);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Package className="h-6 w-6 text-primary-600" /> Inventory</h1>
        <div className="flex gap-2">
          <button onClick={() => openModal("item")} className="btn-primary flex items-center gap-2"><Plus className="h-4 w-4" /> Add Item</button>
          <button onClick={() => openModal("purchase")} className="btn-secondary text-sm">Purchase</button>
          <button onClick={() => openModal("issue")} className="btn-secondary text-sm">Issue</button>
        </div>
      </div>

      {!loading && lowStock.length > 0 && !dismissedAlert && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-800">
                  {lowStock.length} item{lowStock.length > 1 ? "s are" : " is"} running low on stock
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {lowStock.map((i: any) => (
                    <span key={i.id} className="text-xs px-2 py-1 bg-white border border-amber-200 rounded-full text-amber-700">
                      {i.name}: {i.currentStock}/{i.minStock} {i.unit}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <button onClick={() => setDismissedAlert(true)} className="text-amber-600 hover:text-amber-800 text-xs font-medium flex-shrink-0">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {loading ? <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm"><thead><tr className="border-b bg-gray-50">
            <th className="px-4 py-3 text-left">Item</th><th className="px-4 py-3 text-left">Category</th>
            <th className="px-4 py-3 text-center">Stock</th><th className="px-4 py-3 text-center">Min</th><th className="px-4 py-3 text-center">Status</th><th className="px-4 py-3 text-center">Actions</th>
          </tr></thead><tbody>
            {items.map(i => (<tr key={i.id} className="border-b">
              <td className="px-4 py-3 font-medium">{i.name}</td><td className="px-4 py-3 text-xs">{i.category}</td>
              <td className="px-4 py-3 text-center font-bold">{i.currentStock} {i.unit}</td>
              <td className="px-4 py-3 text-center text-gray-500">{i.minStock}</td>
              <td className="px-4 py-3 text-center">{i.currentStock <= i.minStock ? <span className="text-red-600 flex items-center justify-center gap-1"><AlertTriangle className="h-3 w-3" /> Low</span> : <span className="text-green-600">OK</span>}</td>
              <td className="px-4 py-3 text-center">
                <button onClick={() => openDetail(i.id)} title="View Details" className="text-gray-500 hover:text-gray-700 mr-3"><Eye className="h-4 w-4 inline" /></button>
                <button onClick={() => deleteItem(i.id, i.name)} className="text-red-500 hover:text-red-700"><Trash2 className="h-4 w-4 inline" /></button>
              </td>
            </tr>))}
          </tbody></table>
        </div>
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={modalType === "item" ? "Add Item" : modalType === "purchase" ? "Purchase Stock" : "Issue Stock"}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {modalType === "item" ? (<>
            <div><label className="block text-sm font-medium mb-1">Name *</label><input className="input-field" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required /></div>
            <div className="grid grid-cols-3 gap-4">
              <div><label className="block text-sm font-medium mb-1">Category</label><input className="input-field" value={form.category} onChange={e => setForm({...form, category: e.target.value})} /></div>
              <div><label className="block text-sm font-medium mb-1">Unit</label><input className="input-field" value={form.unit} onChange={e => setForm({...form, unit: e.target.value})} /></div>
              <div><label className="block text-sm font-medium mb-1">Min Stock</label><input type="number" className="input-field" value={form.minStock} onChange={e => setForm({...form, minStock: e.target.value})} /></div>
            </div>
          </>) : modalType === "purchase" ? (<>
            <div><label className="block text-sm font-medium mb-1">Item *</label><select className="input-field" value={form.itemId} onChange={e => setForm({...form, itemId: e.target.value})} required><option value="">Select</option>{items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></div>
            <div className="grid grid-cols-3 gap-4">
              <div><label className="block text-sm font-medium mb-1">Qty *</label><input type="number" className="input-field" value={form.quantity} onChange={e => setForm({...form, quantity: e.target.value})} required /></div>
              <div><label className="block text-sm font-medium mb-1">Rate *</label><input type="number" className="input-field" value={form.rate} onChange={e => setForm({...form, rate: e.target.value})} required /></div>
              <div><label className="block text-sm font-medium mb-1">Vendor</label><input className="input-field" value={form.vendor} onChange={e => setForm({...form, vendor: e.target.value})} /></div>
            </div>
          </>) : (<>
            <div><label className="block text-sm font-medium mb-1">Item *</label><select className="input-field" value={form.itemId} onChange={e => setForm({...form, itemId: e.target.value})} required><option value="">Select</option>{items.map(i => <option key={i.id} value={i.id}>{i.name} ({i.currentStock})</option>)}</select></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium mb-1">Qty *</label><input type="number" className="input-field" value={form.quantity} onChange={e => setForm({...form, quantity: e.target.value})} required /></div>
              <div><label className="block text-sm font-medium mb-1">Issued To *</label><input className="input-field" value={form.issuedTo} onChange={e => setForm({...form, issuedTo: e.target.value})} required /></div>
            </div>
            <div><label className="block text-sm font-medium mb-1">Purpose</label><input className="input-field" value={form.purpose} onChange={e => setForm({...form, purpose: e.target.value})} /></div>
          </>)}
          <div className="flex justify-end gap-3 pt-4 border-t"><button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button><button type="submit" className="btn-primary">Save</button></div>
        </form>
      </Modal>

      <Modal isOpen={!!detail} onClose={() => setDetail(null)} title={detail?.name ? `Item - ${detail.name}` : "Item Details"}>
        {detailLoading ? (
          <div className="flex justify-center py-8"><div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
        ) : detail ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div><p className="text-gray-500">Category</p><p className="font-medium">{detail.category || "-"}</p></div>
              <div><p className="text-gray-500">Current Stock</p><p className="font-medium">{detail.currentStock} {detail.unit}</p></div>
              <div><p className="text-gray-500">Min Stock</p><p className="font-medium">{detail.minStock}</p></div>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-gray-600 mb-2">Purchase History</h4>
              {detail.purchases?.length > 0 ? (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {detail.purchases.map((p: any) => (
                    <div key={p.id} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded-lg text-sm">
                      <span>{p.vendor || "-"}: {p.quantity} @ Rs {p.rate}</span>
                      <span className="text-xs text-gray-500">Rs {p.totalCost}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-gray-400">No purchases recorded yet.</p>}
            </div>
            <div>
              <h4 className="text-sm font-semibold text-gray-600 mb-2">Issue History</h4>
              {detail.issues?.length > 0 ? (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {detail.issues.map((iss: any) => (
                    <div key={iss.id} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded-lg text-sm">
                      <span>{iss.issuedTo}: {iss.quantity} {detail.unit}</span>
                      <span className="text-xs text-gray-500">{iss.purpose || "-"}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-gray-400">No issues recorded yet.</p>}
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
