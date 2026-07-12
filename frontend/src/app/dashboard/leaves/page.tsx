"use client";

import { useState, useEffect } from "react";
import { Calendar, Check, X, Clock, Plus, Trash2, Pencil, Eye } from "lucide-react";
import api from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import Modal from "@/components/ui/Modal";

export default function LeavesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "SUPER_ADMIN" || user?.role === "BRANCH_ADMIN";

  const [tab, setTab] = useState<"pending" | "all" | "balance" | "types">("pending");
  const [applications, setApplications] = useState<any[]>([]);
  const [balances, setBalances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Leave Types management (admin-only) - LeaveType has no branchId in
  // the schema, it's a single system-wide list shared by every branch
  // (e.g. CL/SL/EL), so a school wanting to add "Sabbatical Leave" now
  // has somewhere to do it instead of only via the seed script.
  const [leaveTypes, setLeaveTypes] = useState<any[]>([]);
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [editingType, setEditingType] = useState<any>(null);
  const [typeForm, setTypeForm] = useState({ name: "", code: "", maxDays: "12", carryForward: false });
  const [savingType, setSavingType] = useState(false);
  const [typeError, setTypeError] = useState("");

  const fetchData = async () => {
    setLoading(true);
    try {
      if (tab === "balance") {
        // For admin, show all staff—for staff, show own
        const res = await api.get("/hr/leave/balance/self");
        setBalances(res.data.data || []);
      } else if (tab === "types") {
        const res = await api.get("/hr/leave/types", { params: { includeInactive: "true" } });
        setLeaveTypes(res.data.data || []);
      } else {
        const params: any = {};
        if (tab === "pending") params.status = "PENDING";
        const res = await api.get("/hr/leave/applications", { params });
        setApplications(res.data.data || []);
      }
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [tab]);

  const handleAction = async (id: string, status: "APPROVED" | "REJECTED") => {
    try {
      await api.patch(`/hr/leave/${id}/status`, { status });
      fetchData();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  const openAddType = () => {
    setEditingType(null);
    setTypeForm({ name: "", code: "", maxDays: "12", carryForward: false });
    setTypeError("");
    setShowTypeModal(true);
  };

  const openEditType = (lt: any) => {
    setEditingType(lt);
    setTypeForm({ name: lt.name, code: lt.code, maxDays: String(lt.maxDays), carryForward: lt.carryForward });
    setTypeError("");
    setShowTypeModal(true);
  };

  const handleSaveType = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingType(true);
    setTypeError("");
    try {
      if (editingType) {
        await api.put(`/hr/leave/types/${editingType.id}`, {
          name: typeForm.name, maxDays: parseInt(typeForm.maxDays, 10), carryForward: typeForm.carryForward,
        });
      } else {
        await api.post("/hr/leave/types", {
          name: typeForm.name, code: typeForm.code, maxDays: parseInt(typeForm.maxDays, 10), carryForward: typeForm.carryForward,
        });
      }
      setShowTypeModal(false);
      await fetchData();
    } catch (err: any) {
      setTypeError(err.response?.data?.message || "Failed to save leave type");
    } finally {
      setSavingType(false);
    }
  };

  const handleToggleActive = async (lt: any) => {
    try {
      await api.put(`/hr/leave/types/${lt.id}`, { isActive: !lt.isActive });
      fetchData();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  const handleDeleteType = async (lt: any) => {
    if (!confirm(`Delete leave type "${lt.name}"? This only works if no leave applications use it yet.`)) return;
    try {
      await api.delete(`/hr/leave/types/${lt.id}`);
      fetchData();
    } catch (err: any) { alert(err.response?.data?.message || "Failed to delete leave type"); }
  };

  // View Details - shows how many leave applications reference this
  // type via the new getLeaveTypeById endpoint (useful context before
  // deciding to deactivate vs. attempting a delete, which is blocked
  // outright once any application exists).
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const openDetail = async (id: string) => {
    setDetail({});
    setDetailLoading(true);
    try {
      const res = await api.get(`/hr/leave/types/${id}`);
      setDetail(res.data.data);
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to load leave type details");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Calendar className="h-6 w-6 text-primary-600" /> Leave Management
        </h1>
      </div>

      <div className="flex gap-2 mb-6">
        {[
          { key: "pending", label: "Pending Approvals" },
          { key: "all", label: "All Applications" },
          { key: "balance", label: "Leave Balance" },
          ...(isAdmin ? [{ key: "types", label: "Leave Types" }] : []),
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key as any)}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === t.key ? "bg-primary-600 text-white" : "bg-gray-100 text-gray-700"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "types" ? (
        loading ? (
          <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
        ) : (
          <div className="card overflow-x-auto">
            <div className="flex justify-end mb-4">
              <button onClick={openAddType} className="btn-primary flex items-center gap-1.5 text-sm">
                <Plus className="h-4 w-4" /> Add Leave Type
              </button>
            </div>
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-gray-50">
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Code</th>
                <th className="px-4 py-3 text-center">Max Days/Year</th>
                <th className="px-4 py-3 text-center">Carry Forward</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr></thead>
              <tbody>
                {leaveTypes.map((lt) => (
                  <tr key={lt.id} className="border-b">
                    <td className="px-4 py-3 font-medium">{lt.name}</td>
                    <td className="px-4 py-3 font-mono text-xs">{lt.code}</td>
                    <td className="px-4 py-3 text-center">{lt.maxDays}</td>
                    <td className="px-4 py-3 text-center">{lt.carryForward ? "Yes" : "No"}</td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => handleToggleActive(lt)} className={`px-2 py-0.5 rounded-full text-xs font-medium ${lt.isActive ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-600"}`}>
                        {lt.isActive ? "Active" : "Inactive"}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex justify-center gap-2">
                        <button onClick={() => openDetail(lt.id)} className="text-gray-500 hover:text-gray-700" title="View Details"><Eye className="h-4 w-4" /></button>
                        <button onClick={() => openEditType(lt)} className="text-primary-600 hover:text-primary-700" title="Edit"><Pencil className="h-4 w-4" /></button>
                        <button onClick={() => handleDeleteType(lt)} className="text-red-500 hover:text-red-700" title="Delete"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {leaveTypes.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No leave types configured</td></tr>}
              </tbody>
            </table>
          </div>
        )
      ) : loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : tab === "balance" ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {balances.map(b => (
            <div key={b.code} className="card text-center">
              <p className="text-xs text-gray-500 mb-1">{b.leaveType}</p>
              <p className="text-2xl font-bold text-primary-700">{b.remaining}</p>
              <p className="text-xs text-gray-400">of {b.maxDays} | Used: {b.used}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-gray-50">
              <th className="px-4 py-3 text-left">Staff</th>
              <th className="px-4 py-3 text-left">Type</th>
              <th className="px-4 py-3 text-left">From</th>
              <th className="px-4 py-3 text-left">To</th>
              <th className="px-4 py-3 text-center">Days</th>
              <th className="px-4 py-3 text-left">Reason</th>
              <th className="px-4 py-3 text-center">Status</th>
              {tab === "pending" && <th className="px-4 py-3 text-center">Actions</th>}
            </tr></thead>
            <tbody>
              {applications.map(a => (
                <tr key={a.id} className="border-b">
                  <td className="px-4 py-3 font-medium">{a.staff?.user?.name}</td>
                  <td className="px-4 py-3">{a.leaveType?.name}</td>
                  <td className="px-4 py-3">{formatDate(a.fromDate)}</td>
                  <td className="px-4 py-3">{formatDate(a.toDate)}</td>
                  <td className="px-4 py-3 text-center font-bold">{a.days}</td>
                  <td className="px-4 py-3 text-gray-600 max-w-[200px] truncate">{a.reason}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      a.status === "APPROVED" ? "bg-green-100 text-green-700" :
                      a.status === "REJECTED" ? "bg-red-100 text-red-700" :
                      "bg-yellow-100 text-yellow-700"
                    }`}>{a.status}</span>
                  </td>
                  {tab === "pending" && (
                    <td className="px-4 py-3 text-center">
                      <div className="flex justify-center gap-2">
                        <button onClick={() => handleAction(a.id, "APPROVED")}
                          className="p-1.5 rounded-full bg-green-100 hover:bg-green-200 text-green-700" title="Approve">
                          <Check className="h-4 w-4" />
                        </button>
                        <button onClick={() => handleAction(a.id, "REJECTED")}
                          className="p-1.5 rounded-full bg-red-100 hover:bg-red-200 text-red-700" title="Reject">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {applications.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">No applications</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={showTypeModal} onClose={() => setShowTypeModal(false)} title={editingType ? "Edit Leave Type" : "Add Leave Type"}>
        <form onSubmit={handleSaveType} className="space-y-4">
          {typeError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{typeError}</div>}
          <div>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input className="input-field" value={typeForm.name} onChange={(e) => setTypeForm({ ...typeForm, name: e.target.value })} placeholder="e.g. Sabbatical Leave" required />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Code *</label>
            <input
              className="input-field disabled:bg-gray-100"
              value={typeForm.code}
              onChange={(e) => setTypeForm({ ...typeForm, code: e.target.value.toUpperCase() })}
              placeholder="e.g. SAB"
              disabled={!!editingType}
              required
            />
            {editingType && <p className="text-xs text-gray-400 mt-1">Code cannot be changed after creation.</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Max Days/Year *</label>
              <input type="number" min={1} className="input-field" value={typeForm.maxDays} onChange={(e) => setTypeForm({ ...typeForm, maxDays: e.target.value })} required />
            </div>
            <div className="flex items-end pb-2.5">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={typeForm.carryForward} onChange={(e) => setTypeForm({ ...typeForm, carryForward: e.target.checked })} />
                Carry forward unused days
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowTypeModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={savingType} className="btn-primary disabled:opacity-50">
              {savingType ? "Saving..." : editingType ? "Save Changes" : "Create"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!detail} onClose={() => setDetail(null)} title={detail?.name ? `Leave Type - ${detail.name}` : "Leave Type Details"}>
        {detailLoading ? (
          <div className="flex justify-center py-8"><div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
        ) : detail ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-gray-500">Code</p><p className="font-medium font-mono">{detail.code}</p></div>
              <div><p className="text-gray-500">Max Days/Year</p><p className="font-medium">{detail.maxDays}</p></div>
              <div><p className="text-gray-500">Carry Forward</p><p className="font-medium">{detail.carryForward ? "Yes" : "No"}</p></div>
              <div><p className="text-gray-500">Status</p><p className="font-medium">{detail.isActive ? "Active" : "Inactive"}</p></div>
              <div><p className="text-gray-500">Applications Using This Type</p><p className="font-medium">{detail.applicationCount}</p></div>
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
