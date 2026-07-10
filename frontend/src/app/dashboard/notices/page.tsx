"use client";

import { useState, useEffect } from "react";
import { Bell, Plus, Pin, Trash2 } from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";
import { formatDate } from "@/lib/utils";

export default function NoticesPage() {
  const [notices, setNotices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ title: "", body: "", type: "ALL", expiryDate: "", branchId: "" });

  const fetch = async () => {
    setLoading(true);
    try { const res = await api.get("/communication/notices"); setNotices(res.data.data || []); }
    catch {} finally { setLoading(false); }
  };
  useEffect(() => { fetch(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api.post("/communication/notices", form); setShowModal(false); fetch(); }
    catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  const togglePin = async (id: string) => { await api.patch(`/communication/notices/${id}/pin`); fetch(); };
  const deleteNotice = async (id: string) => { if (confirm("Delete?")) { await api.delete(`/communication/notices/${id}`); fetch(); } };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Bell className="h-6 w-6 text-primary-600" /> Notices</h1>
        <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2"><Plus className="h-4 w-4" /> New Notice</button>
      </div>

      {loading ? <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div> : (
        <div className="space-y-3">
          {notices.map(n => (
            <div key={n.id} className={`card ${n.isPinned ? "border-l-4 border-l-yellow-400" : ""}`}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    {n.isPinned && <Pin className="h-4 w-4 text-yellow-500" />}
                    <h3 className="font-semibold text-gray-900">{n.title}</h3>
                    <span className="text-xs px-2 py-0.5 bg-gray-100 rounded">{n.type}</span>
                  </div>
                  <p className="text-sm text-gray-600 mb-2">{n.body}</p>
                  <p className="text-xs text-gray-400">{formatDate(n.createdAt)}</p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => togglePin(n.id)} className="p-1 rounded hover:bg-gray-100"><Pin className="h-4 w-4 text-gray-400" /></button>
                  <button onClick={() => deleteNotice(n.id)} className="p-1 rounded hover:bg-gray-100"><Trash2 className="h-4 w-4 text-red-400" /></button>
                </div>
              </div>
            </div>
          ))}
          {notices.length === 0 && <p className="text-center text-gray-500 py-8">No notices</p>}
        </div>
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Publish Notice">
        <form onSubmit={handleCreate} className="space-y-4">
          <div><label className="block text-sm font-medium mb-1">Title *</label><input className="input-field" value={form.title} onChange={e => setForm({...form, title: e.target.value})} required /></div>
          <div><label className="block text-sm font-medium mb-1">Content *</label><textarea className="input-field" rows={4} value={form.body} onChange={e => setForm({...form, body: e.target.value})} required /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Target</label>
              <select className="input-field" value={form.type} onChange={e => setForm({...form, type: e.target.value})}>
                <option value="ALL">All</option><option value="STUDENTS">Students</option><option value="PARENTS">Parents</option><option value="TEACHERS">Teachers</option><option value="STAFF">Staff</option>
              </select></div>
            <div><label className="block text-sm font-medium mb-1">Expiry Date</label><input type="date" className="input-field" value={form.expiryDate} onChange={e => setForm({...form, expiryDate: e.target.value})} /></div>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t"><button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button><button type="submit" className="btn-primary">Publish</button></div>
        </form>
      </Modal>
    </div>
  );
}
