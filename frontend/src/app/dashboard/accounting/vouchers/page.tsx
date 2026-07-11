"use client";

import { useState, useEffect } from "react";
import { FileText, Plus } from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";
import { formatCurrency, formatDate } from "@/lib/utils";

export default function VouchersPage() {
  const [vouchers, setVouchers] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  // Note: branchId is deliberately NOT part of this form - the backend
  // always scopes creation to the logged-in user's own branch.
  const [form, setForm] = useState({
    type: "PAYMENT", date: "", narration: "",
    debitAccountId: "", creditAccountId: "", amount: "",
  });

  const fetch = async () => {
    setLoading(true);
    try {
      const [vRes, aRes] = await Promise.all([api.get("/accounting/daybook"), api.get("/accounting/accounts")]);
      setVouchers(vRes.data.data || []);
      setAccounts(aRes.data.data || []);
    } catch {} finally { setLoading(false); }
  };
  useEffect(() => { fetch(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/accounting/vouchers", {
        ...form, entries: [{ debitAccountId: form.debitAccountId, creditAccountId: form.creditAccountId, amount: parseFloat(form.amount), narration: form.narration }],
      });
      setShowModal(false); fetch();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2"><FileText className="h-6 w-6 text-primary-600" /> Vouchers / Day Book</h1>
        <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2"><Plus className="h-4 w-4" /> New Voucher</button>
      </div>


      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-gray-50">
              <th className="px-4 py-3 text-left">Date</th><th className="px-4 py-3 text-left">Voucher No</th>
              <th className="px-4 py-3 text-left">Type</th><th className="px-4 py-3 text-left">Narration</th>
              <th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3">Status</th>
            </tr></thead>
            <tbody>
              {vouchers.map((v) => (
                <tr key={v.id} className="border-b"><td className="px-4 py-3">{formatDate(v.date)}</td>
                  <td className="px-4 py-3 font-mono text-xs">{v.voucherNo}</td>
                  <td className="px-4 py-3"><span className="px-2 py-0.5 rounded text-xs bg-gray-100">{v.type}</span></td>
                  <td className="px-4 py-3 text-gray-600">{v.narration || "-"}</td>
                  <td className="px-4 py-3 text-right font-medium">{formatCurrency(v.totalAmount)}</td>
                  <td className="px-4 py-3">{v.isApproved ? <span className="text-green-600 text-xs">Approved</span> : <span className="text-yellow-600 text-xs">Pending</span>}</td>
                </tr>
              ))}
              {vouchers.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No vouchers</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Create Voucher" size="lg">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Type *</label>
              <select className="input-field" value={form.type} onChange={(e) => setForm({...form, type: e.target.value})}>
                <option value="PAYMENT">Payment</option><option value="RECEIPT">Receipt</option>
                <option value="JOURNAL">Journal</option><option value="CONTRA">Contra</option>
              </select></div>
            <div><label className="block text-sm font-medium mb-1">Date *</label>
              <input type="date" className="input-field" value={form.date} onChange={(e) => setForm({...form, date: e.target.value})} required /></div>
            <div><label className="block text-sm font-medium mb-1">Debit Account *</label>
              <select className="input-field" value={form.debitAccountId} onChange={(e) => setForm({...form, debitAccountId: e.target.value})} required>
                <option value="">Select</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.code} - {a.name}</option>)}
              </select></div>
            <div><label className="block text-sm font-medium mb-1">Credit Account *</label>
              <select className="input-field" value={form.creditAccountId} onChange={(e) => setForm({...form, creditAccountId: e.target.value})} required>
                <option value="">Select</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.code} - {a.name}</option>)}
              </select></div>
            <div><label className="block text-sm font-medium mb-1">Amount *</label>
              <input type="number" className="input-field" value={form.amount} onChange={(e) => setForm({...form, amount: e.target.value})} required /></div>
          </div>
          <div><label className="block text-sm font-medium mb-1">Narration</label>
            <input className="input-field" value={form.narration} onChange={(e) => setForm({...form, narration: e.target.value})} /></div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">Create Voucher</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
