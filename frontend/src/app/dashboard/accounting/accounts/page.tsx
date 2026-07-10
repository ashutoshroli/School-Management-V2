"use client";

import { useState, useEffect } from "react";
import { BookOpen, Plus } from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";

interface Account {
  id: string; name: string; code: string; type: string;
  isSystem: boolean; isActive: boolean;
  children: { id: string; name: string; code: string }[];
}

const TYPE_COLORS: Record<string, string> = {
  ASSET: "bg-blue-100 text-blue-700", LIABILITY: "bg-red-100 text-red-700",
  INCOME: "bg-green-100 text-green-700", EXPENSE: "bg-orange-100 text-orange-700",
  CAPITAL: "bg-purple-100 text-purple-700",
};

export default function ChartOfAccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: "", code: "", type: "ASSET", branchId: "", parentId: "" });

  const fetch = async () => {
    setLoading(true);
    try { const r = await api.get("/accounting/accounts"); setAccounts(r.data.data || []); }
    catch {} finally { setLoading(false); }
  };
  useEffect(() => { fetch(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/accounting/accounts", { ...form, parentId: form.parentId || undefined });
      setShowModal(false); setForm({ name: "", code: "", type: "ASSET", branchId: "", parentId: "" }); fetch();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  const grouped = {
    ASSET: accounts.filter(a => a.type === "ASSET"),
    LIABILITY: accounts.filter(a => a.type === "LIABILITY"),
    INCOME: accounts.filter(a => a.type === "INCOME"),
    EXPENSE: accounts.filter(a => a.type === "EXPENSE"),
    CAPITAL: accounts.filter(a => a.type === "CAPITAL"),
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2"><BookOpen className="h-6 w-6 text-primary-600" /> Chart of Accounts</h1>
        <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2"><Plus className="h-4 w-4" /> Add Account</button>
      </div>


      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([type, accs]) => (
            <div key={type} className="card">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${TYPE_COLORS[type]}`}>{type}</span>
                <span className="text-gray-500 text-sm">({accs.length} accounts)</span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {accs.map((a) => (
                  <div key={a.id} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded-lg">
                    <div><span className="font-medium text-sm">{a.name}</span><span className="text-xs text-gray-400 ml-2">{a.code}</span></div>
                    {a.isSystem && <span className="text-xs text-gray-400">system</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Add Account">
        <form onSubmit={handleCreate} className="space-y-4">
          <div><label className="block text-sm font-medium mb-1">Name *</label><input className="input-field" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} required /></div>
          <div><label className="block text-sm font-medium mb-1">Code *</label><input className="input-field" value={form.code} onChange={(e) => setForm({...form, code: e.target.value})} required /></div>
          <div><label className="block text-sm font-medium mb-1">Type *</label>
            <select className="input-field" value={form.type} onChange={(e) => setForm({...form, type: e.target.value})}>
              <option value="ASSET">Asset</option><option value="LIABILITY">Liability</option>
              <option value="INCOME">Income</option><option value="EXPENSE">Expense</option><option value="CAPITAL">Capital</option>
            </select></div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">Create</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
