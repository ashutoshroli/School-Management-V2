"use client";

import { useState, useEffect } from "react";
import { Building2, Plus, Edit, Users, GraduationCap } from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";
import DataTable from "@/components/ui/DataTable";
import ErrorBanner from "@/components/ui/ErrorBanner";

interface Branch {
  id: string;
  name: string;
  code: string;
  city: string;
  phone: string;
  email: string;
  isActive: boolean;
  _count: { students: number; staff: number };
}

export default function BranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editBranch, setEditBranch] = useState<Branch | null>(null);
  const [form, setForm] = useState({
    name: "", code: "", address: "", city: "", state: "", pincode: "", phone: "", email: "",
  });

  const [error, setError] = useState<string | null>(null);

  const fetchBranches = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.get("/branches");
      setBranches(res.data.data || []);
    } catch (err: any) {
      console.error("Failed to fetch branches", err);
      setError(err.response?.data?.message || "Failed to load branches. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchBranches(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editBranch) {
        await api.put(`/branches/${editBranch.id}`, form);
      } else {
        await api.post("/branches", form);
      }
      setShowModal(false);
      setEditBranch(null);
      setForm({ name: "", code: "", address: "", city: "", state: "", pincode: "", phone: "", email: "" });
      fetchBranches();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to save branch");
    }
  };

  const openEdit = (branch: Branch) => {
    setEditBranch(branch);
    setForm({
      name: branch.name, code: branch.code, address: "", city: branch.city || "",
      state: "", pincode: "", phone: branch.phone || "", email: branch.email || "",
    });
    setShowModal(true);
  };

  const columns = [
    { key: "name", label: "Branch Name" },
    { key: "code", label: "Code" },
    { key: "city", label: "City" },
    {
      key: "students",
      label: "Students",
      render: (b: Branch) => (
        <span className="flex items-center gap-1">
          <GraduationCap className="h-4 w-4 text-blue-500" />
          {b._count?.students || 0}
        </span>
      ),
    },
    {
      key: "staff",
      label: "Staff",
      render: (b: Branch) => (
        <span className="flex items-center gap-1">
          <Users className="h-4 w-4 text-green-500" />
          {b._count?.staff || 0}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (b: Branch) => (
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${b.isActive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
          {b.isActive ? "Active" : "Inactive"}
        </span>
      ),
    },
    {
      key: "actions",
      label: "Actions",
      render: (b: Branch) => (
        <button onClick={() => openEdit(b)} className="p-1 rounded hover:bg-gray-100">
          <Edit className="h-4 w-4 text-gray-600" />
        </button>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Building2 className="h-6 w-6 text-primary-600" /> Branches
          </h1>
          <p className="text-gray-500 mt-1">Manage school branches / campuses</p>
        </div>
        <button onClick={() => { setEditBranch(null); setForm({ name: "", code: "", address: "", city: "", state: "", pincode: "", phone: "", email: "" }); setShowModal(true); }} className="btn-primary flex items-center gap-2">
          <Plus className="h-4 w-4" /> Add Branch
        </button>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchBranches} />}

      <div className="card">
        <DataTable columns={columns} data={branches} loading={loading} emptyMessage="No branches found" />
      </div>

      {/* Add/Edit Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editBranch ? "Edit Branch" : "Add New Branch"} size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Branch Name *</label>
              <input className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Branch Code *</label>
              <input className="input-field" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required disabled={!!editBranch} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
              <input className="input-field" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
              <input className="input-field" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input className="input-field" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input className="input-field" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
            <textarea className="input-field" rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">{editBranch ? "Update" : "Create"} Branch</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
