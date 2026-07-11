"use client";

import { useState, useEffect } from "react";
import { BookOpen, Plus, Trash2, Sparkles } from "lucide-react";
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
  const [settingUpDefaults, setSettingUpDefaults] = useState(false);
  // Note: branchId is deliberately NOT part of this form - the backend
  // always scopes creation to the logged-in user's own branch.
  const [form, setForm] = useState({ name: "", code: "", type: "ASSET", parentId: "" });

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
      setShowModal(false); setForm({ name: "", code: "", type: "ASSET", parentId: "" }); fetch();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  const deleteAccount = async (id: string, name: string) => {
    if (!confirm(`Delete account "${name}"?`)) return;
    try {
      await api.delete(`/accounting/accounts/${id}`);
      fetch();
    } catch (err: any) { alert(err.response?.data?.message || "Cannot delete this account"); }
  };

  // Creates the baseline Cash/Bank/Fee Income/etc accounts for this
  // branch if they're missing. Required before fee payments can be
  // collected - see autoPostToAccounting's doc comment in
  // feePayment.service.ts for why "Failed to collect payment" happens
  // without this.
  const setupDefaults = async () => {
    setSettingUpDefaults(true);
    try {
      const res = await api.post("/accounting/accounts/setup-defaults");
      alert(res.data.message);
      fetch();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to set up default accounts");
    } finally {
      setSettingUpDefaults(false);
    }
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
        <div className="flex items-center gap-3">
          <button onClick={setupDefaults} disabled={settingUpDefaults} className="btn-secondary flex items-center gap-2 disabled:opacity-50">
            <Sparkles className="h-4 w-4" /> {settingUpDefaults ? "Setting up..." : "Set Up Default Accounts"}
          </button>
          <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2"><Plus className="h-4 w-4" /> Add Account</button>
        </div>
      </div>

      {accounts.length === 0 && !loading && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No accounts found for this branch yet. Click <span className="font-medium">"Set Up Default Accounts"</span> above -
          this is required before you can collect fee payments (fee collection posts to the Cash and Fee Income accounts automatically).
        </div>
      )}


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
                    {a.isSystem ? (
                      <span className="text-xs text-gray-400">system</span>
                    ) : (
                      <button onClick={() => deleteAccount(a.id, a.name)} title="Delete" className="text-red-400 hover:text-red-600">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
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
