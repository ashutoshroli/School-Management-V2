"use client";

import { useState, useEffect } from "react";
import { ArrowRightLeft, Check, X, Send } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

/**
 * Branch Transfer (spec Section 5) - Director-direct or Principal
 * -initiated transfer of students/staff between branches, with
 * destination-Principal approval, fee-dues 3-option handling, and
 * academic-data summary-vs-full-unlock requests.
 */
export default function BranchTransferPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"students" | "staff">("students");
  const [transfers, setTransfers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ subjectId: "", destinationBranchId: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const fetchTransfers = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/branch-transfer/${tab}`);
      setTransfers(res.data.data || []);
    } catch { setTransfers([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchTransfers(); }, [tab]);
  useEffect(() => {
    api.get("/branches").then((res) => setBranches(res.data.data?.items || res.data.data || [])).catch(() => setBranches([]));
  }, []);

  const handleInitiate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const idField = tab === "students" ? "studentId" : "staffId";
      await api.post(`/branch-transfer/${tab}`, { [idField]: form.subjectId, destinationBranchId: form.destinationBranchId });
      setShowModal(false);
      setForm({ subjectId: "", destinationBranchId: "" });
      fetchTransfers();
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to initiate transfer");
    } finally { setSaving(false); }
  };

  const respond = async (id: string, decision: "APPROVE" | "REJECT") => {
    try {
      await api.patch(`/branch-transfer/${tab}/${id}/respond`, { decision });
      fetchTransfers();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  const complete = async (id: string) => {
    if (!confirm("Complete this transfer now?")) return;
    try {
      await api.post(`/branch-transfer/${tab}/${id}/complete`);
      fetchTransfers();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  const isDirectorOrPrincipal = user?.role === "SUPER_ADMIN" || user?.role === "BRANCH_ADMIN" || user?.role === "PRINCIPAL" || user?.role === "VICE_PRINCIPAL";

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ArrowRightLeft className="h-6 w-6 text-primary-600" /> Branch Transfer
          </h1>
          <p className="text-gray-500 mt-1">Transfer students/staff between branches - Director direct, or Principal-initiated with approval</p>
        </div>
        {isDirectorOrPrincipal && (
          <button onClick={() => { setError(""); setShowModal(true); }} className="btn-primary flex items-center gap-1.5 text-sm">
            <Send className="h-4 w-4" /> Initiate Transfer
          </button>
        )}
      </div>

      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab("students")} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "students" ? "bg-primary-600 text-white" : "bg-gray-100 text-gray-600"}`}>Students</button>
        <button onClick={() => setTab("staff")} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "staff" ? "bg-primary-600 text-white" : "bg-gray-100 text-gray-600"}`}>Staff</button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : transfers.length === 0 ? (
        <div className="card text-center py-12"><p className="text-gray-500">No transfer requests yet.</p></div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="px-4 py-3 text-left">{tab === "students" ? "Student" : "Staff"}</th>
                <th className="px-4 py-3 text-left">Origin</th>
                <th className="px-4 py-3 text-left">Destination</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((t) => (
                <tr key={t.id} className="border-b">
                  <td className="px-4 py-3">{(tab === "students" ? t.student : t.staff)?.user?.name}</td>
                  <td className="px-4 py-3">{t.originBranch?.name}</td>
                  <td className="px-4 py-3">{t.destinationBranch?.name}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100">{t.status}</span>
                    {t.outstandingDuesAtOrigin && <div className="text-xs text-amber-600 mt-1">Dues: Rs {Number(t.outstandingDuesAtOrigin).toLocaleString()}</div>}
                  </td>
                  <td className="px-4 py-3 space-x-2">
                    {t.status === "PENDING" && (
                      <>
                        <button onClick={() => respond(t.id, "APPROVE")} className="p-1.5 text-green-600 hover:bg-green-50 rounded"><Check className="h-4 w-4" /></button>
                        <button onClick={() => respond(t.id, "REJECT")} className="p-1.5 text-red-600 hover:bg-red-50 rounded"><X className="h-4 w-4" /></button>
                      </>
                    )}
                    {t.status === "APPROVED" && (
                      <button onClick={() => complete(t.id)} className="text-primary-600 hover:underline text-xs font-medium">Complete Transfer</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full">
            <h2 className="text-lg font-bold mb-4">Initiate {tab === "students" ? "Student" : "Staff"} Transfer</h2>
            <form onSubmit={handleInitiate} className="space-y-4">
              {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>}
              <div>
                <label className="block text-sm font-medium mb-1">{tab === "students" ? "Student ID" : "Staff ID"} *</label>
                <input className="input-field" value={form.subjectId} onChange={(e) => setForm({ ...form, subjectId: e.target.value })} required placeholder="Paste ID from Students/Staff page" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Destination Branch *</label>
                <select className="input-field" value={form.destinationBranchId} onChange={(e) => setForm({ ...form, destinationBranchId: e.target.value })} required>
                  <option value="">Select branch</option>
                  {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary disabled:opacity-50">{saving ? "Submitting..." : "Initiate"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
