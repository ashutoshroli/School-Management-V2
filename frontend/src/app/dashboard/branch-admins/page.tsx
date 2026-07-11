"use client";

import { useState, useEffect } from "react";
import { ShieldCheck, Plus, Power } from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";
import DataTable from "@/components/ui/DataTable";
import ErrorBanner from "@/components/ui/ErrorBanner";

interface Branch {
  id: string;
  name: string;
  code: string;
}

interface BranchAdmin {
  id: string; // staff id
  employeeId: string;
  user: { id: string; name: string; email: string; phone: string | null; isActive: boolean; avatar: string | null };
  branch: { id: string; name: string; code: string };
}

/**
 * Super Admin only. Lets a Super Admin hand a branch off to be
 * self-managed day to day: create a Branch Admin account and assign it
 * to a specific branch, list every Branch Admin across the org, and
 * activate/deactivate them (offboarding) without deleting history.
 *
 * A Branch Admin created here can only ever manage the ONE branch
 * they're assigned to - every "create X" endpoint across the app
 * resolves branchId from that assignment server-side (see
 * resolveEffectiveBranchId in backend/src/utils/branchScope.ts), and
 * canAccessBranch rejects any attempt to touch another branch's data.
 */
export default function BranchAdminsPage() {
  const [admins, setAdmins] = useState<BranchAdmin[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ branchId: "", name: "", email: "", phone: "", password: "" });

  const fetchAdmins = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.get("/branches/admins");
      setAdmins(res.data.data || []);
    } catch (err: any) {
      console.error("Failed to fetch Branch Admins", err);
      setError(err.response?.data?.message || "Failed to load Branch Admins. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const fetchBranches = async () => {
    try {
      const res = await api.get("/branches", { params: { limit: 100 } });
      setBranches(res.data.data || []);
    } catch (err) {
      console.error("Failed to fetch branches", err);
    }
  };

  useEffect(() => {
    fetchAdmins();
    fetchBranches();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/branches/admins", form);
      setShowModal(false);
      setForm({ branchId: "", name: "", email: "", phone: "", password: "" });
      fetchAdmins();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to create Branch Admin");
    }
  };

  const toggleStatus = async (admin: BranchAdmin) => {
    const nextActive = !admin.user.isActive;
    if (!confirm(`${nextActive ? "Activate" : "Deactivate"} ${admin.user.name}?`)) return;
    try {
      await api.patch(`/branches/admins/${admin.id}/status`, { isActive: nextActive });
      fetchAdmins();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to update status");
    }
  };

  const columns = [
    { key: "name", label: "Name", render: (a: BranchAdmin) => <span className="font-medium">{a.user.name}</span> },
    { key: "email", label: "Email", render: (a: BranchAdmin) => a.user.email },
    { key: "phone", label: "Phone", render: (a: BranchAdmin) => a.user.phone || "-" },
    {
      key: "branch",
      label: "Assigned Branch",
      render: (a: BranchAdmin) => (
        <span className="px-2 py-0.5 rounded-full text-xs bg-primary-100 text-primary-700 font-medium">
          {a.branch?.name || "-"}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (a: BranchAdmin) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${a.user.isActive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
          {a.user.isActive ? "Active" : "Deactivated"}
        </span>
      ),
    },
    {
      key: "actions",
      label: "",
      render: (a: BranchAdmin) => (
        <button
          onClick={() => toggleStatus(a)}
          title={a.user.isActive ? "Deactivate" : "Activate"}
          className="p-1 rounded hover:bg-gray-100"
        >
          <Power className={`h-4 w-4 ${a.user.isActive ? "text-red-500" : "text-green-600"}`} />
        </button>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary-600" /> Branch Admins
          </h1>
          <p className="text-gray-500 mt-1">Assign an admin to fully manage a specific branch</p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2">
          <Plus className="h-4 w-4" /> Add Branch Admin
        </button>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchAdmins} />}

      <div className="card">
        <DataTable columns={columns} data={admins} loading={loading} emptyMessage="No Branch Admins yet" />
      </div>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Add Branch Admin">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Assign to Branch *</label>
            <select
              className="input-field"
              value={form.branchId}
              onChange={(e) => setForm({ ...form, branchId: e.target.value })}
              required
            >
              <option value="">Select a branch...</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              This admin will be able to fully manage everything in the selected branch only.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
            <input className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
            <input type="email" className="input-field" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input className="input-field" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="text"
              className="input-field"
              placeholder="Leave blank for default: Admin@123"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">Create Branch Admin</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
