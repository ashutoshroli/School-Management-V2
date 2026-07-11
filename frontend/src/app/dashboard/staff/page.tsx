"use client";

import { useState, useEffect } from "react";
import { Users, Plus, Search, Eye, BadgeCheck } from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";
import DataTable from "@/components/ui/DataTable";
import ErrorBanner from "@/components/ui/ErrorBanner";
import { openPdfInNewTab } from "@/lib/pdf";

interface StaffMember {
  id: string;
  employeeId: string;
  designation: string;
  department: string;
  type: string;
  isActive: boolean;
  cardId: string | null;
  user: { name: string; email: string; phone: string; role: string; avatar: string | null };
}

export default function StaffPage() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showModal, setShowModal] = useState(false);
  // Note: branchId is deliberately NOT part of this form - the backend
  // always scopes creation to the logged-in user's own branch.
  const [form, setForm] = useState({
    name: "", email: "", phone: "", password: "Staff@123",
    designation: "", department: "", type: "TEACHING",
    qualification: "", joiningDate: "",
    panNumber: "", aadharNumber: "", cardId: "", role: "",
  });

  const [error, setError] = useState<string | null>(null);

  const fetchStaff = async () => {
    try {
      setLoading(true);
      setError(null);
      const params: any = { page, limit: 25 };
      if (search) params.search = search;
      if (typeFilter) params.type = typeFilter;
      const res = await api.get("/staff", { params });
      setStaff(res.data.data || []);
      setTotalPages(res.data.pagination?.totalPages || 1);
    } catch (err: any) {
      console.error("Failed to fetch staff", err);
      setError(err.response?.data?.message || "Failed to load staff. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStaff(); }, [page, search, typeFilter]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/staff", form);
      setShowModal(false);
      setForm({
        name: "", email: "", phone: "", password: "Staff@123",
        designation: "", department: "", type: "TEACHING",
        qualification: "", joiningDate: "",
        panNumber: "", aadharNumber: "", cardId: "", role: "",
      });
      fetchStaff();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to create staff");
    }
  };

  const setField = (field: string, value: string) => setForm((p) => ({ ...p, [field]: value }));

  const columns = [
    { key: "empId", label: "Emp. ID", render: (s: StaffMember) => <span className="font-mono text-xs">{s.employeeId}</span> },
    { key: "name", label: "Name", render: (s: StaffMember) => <span className="font-medium">{s.user.name}</span> },
    { key: "designation", label: "Designation" },
    { key: "department", label: "Department" },
    {
      key: "type", label: "Type",
      render: (s: StaffMember) => (
        <span className={`px-2 py-0.5 rounded-full text-xs ${s.type === "TEACHING" ? "bg-blue-100 text-blue-700" : "bg-orange-100 text-orange-700"}`}>
          {s.type === "TEACHING" ? "Teaching" : "Non-Teaching"}
        </span>
      ),
    },
    { key: "role", label: "Role", render: (s: StaffMember) => <span className="text-xs">{s.user.role.replace("_", " ")}</span> },
    {
      key: "status", label: "Status",
      render: (s: StaffMember) => (
        <span className={`px-2 py-0.5 rounded-full text-xs ${s.isActive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
          {s.isActive ? "Active" : "Left"}
        </span>
      ),
    },
    {
      key: "actions", label: "",
      render: (s: StaffMember) => (
        <button
          onClick={() => openPdfInNewTab(`/staff/${s.id}/id-card`)}
          title="Download ID Card"
          className="p-1 rounded hover:bg-gray-100 inline-block"
        >
          <BadgeCheck className="h-4 w-4 text-primary-600" />
        </button>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Users className="h-6 w-6 text-primary-600" /> Staff Management
          </h1>
          <p className="text-gray-500 mt-1">Teaching & Non-teaching staff</p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2">
          <Plus className="h-4 w-4" /> Add Staff
        </button>
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="flex flex-wrap gap-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input className="input-field pl-10" placeholder="Search by name, email, emp ID..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <select className="input-field w-auto" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}>
            <option value="">All Types</option>
            <option value="TEACHING">Teaching</option>
            <option value="NON_TEACHING">Non-Teaching</option>
          </select>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchStaff} />}

      <div className="card">
        <DataTable columns={columns} data={staff} loading={loading} page={page} totalPages={totalPages} onPageChange={setPage} emptyMessage="No staff found" />
      </div>

      {/* Add Staff Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Add New Staff" size="xl">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
              <input className="input-field" value={form.name} onChange={(e) => setField("name", e.target.value)} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
              <input type="email" className="input-field" value={form.email} onChange={(e) => setField("email", e.target.value)} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input className="input-field" value={form.phone} onChange={(e) => setField("phone", e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Designation *</label>
              <input className="input-field" placeholder="e.g., PGT, TGT, Clerk" value={form.designation} onChange={(e) => setField("designation", e.target.value)} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Department *</label>
              <input className="input-field" placeholder="e.g., Science, Admin" value={form.department} onChange={(e) => setField("department", e.target.value)} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type *</label>
              <select className="input-field" value={form.type} onChange={(e) => setField("type", e.target.value)}>
                <option value="TEACHING">Teaching</option>
                <option value="NON_TEACHING">Non-Teaching</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">System Role</label>
              <select className="input-field" value={form.role} onChange={(e) => setField("role", e.target.value)}>
                <option value="">Auto (based on type)</option>
                <option value="TEACHER">Teacher</option>
                <option value="ACCOUNTANT">Accountant</option>
                <option value="LIBRARIAN">Librarian</option>
                <option value="TRANSPORT_MANAGER">Transport Manager</option>
                <option value="WARDEN">Warden</option>
                <option value="STAFF">Staff (Other)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Joining Date *</label>
              <input type="date" className="input-field" value={form.joiningDate} onChange={(e) => setField("joiningDate", e.target.value)} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Qualification</label>
              <input className="input-field" placeholder="M.Sc, B.Ed" value={form.qualification} onChange={(e) => setField("qualification", e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">PAN Number</label>
              <input className="input-field" value={form.panNumber} onChange={(e) => setField("panNumber", e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Aadhar Number</label>
              <input className="input-field" value={form.aadharNumber} onChange={(e) => setField("aadharNumber", e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">RFID Card ID</label>
              <input className="input-field" placeholder="Card UID" value={form.cardId} onChange={(e) => setField("cardId", e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-gray-500">Default password: Staff@123 (staff can change after first login)</p>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">Add Staff</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
