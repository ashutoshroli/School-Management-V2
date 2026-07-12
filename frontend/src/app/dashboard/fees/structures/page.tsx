"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { FileText, Plus, UserCheck, Edit, Trash2, Eye, Users } from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";
import { formatCurrency } from "@/lib/utils";

interface FeeStructure {
  id: string;
  classId: string | null;
  amount: number;
  frequency: string;
  dueDay: number;
  lateFeeType: string;
  lateFeeValue: number;
  isActive: boolean;
  feeCategory: { name: string; code: string };
  // Exactly one of these two is present - class-wise structures have
  // `class`, transport-route-wise ones (created via Transport >
  // Assign Fee, not this page) have `transportRoute` instead. See the
  // FeeStructure model's doc comment in schema.prisma.
  class: { name: string } | null;
  transportRoute: { name: string; startPoint: string; endPoint: string } | null;
  academicYear: { name: string };
  installments: { installmentNo: number; amount: number; dueDate: string }[];
}

export default function FeeStructuresPage() {
  const router = useRouter();
  const [structures, setStructures] = useState<FeeStructure[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [classes, setClasses] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [years, setYears] = useState<any[]>([]);
  // Note: branchId is deliberately NOT part of this form - the backend
  // always scopes creation to the logged-in user's own branch.
  const [form, setForm] = useState({
    classId: "", feeCategoryId: "", academicYearId: "",
    amount: "", frequency: "MONTHLY", dueDay: "10", lateFeeType: "NONE", lateFeeValue: "0",
  });

  // Fee category filter - previously impossible on the backend (only
  // branch/class/year existed).
  const [categoryFilter, setCategoryFilter] = useState("");

  const fetchData = async () => {
    try {
      setLoading(true);
      const [sRes, cRes, catRes, yRes] = await Promise.all([
        api.get("/fees/structures", { params: { feeCategoryId: categoryFilter || undefined } }),
        api.get("/classes"),
        api.get("/fees/categories"),
        api.get("/academic-years"),
      ]);
      setStructures(sRes.data.data || []);
      setClasses(cRes.data.data || []);
      setCategories(catRes.data.data?.filter((c: any) => c.isActive) || []);
      setYears(yRes.data.data || []);
    } catch (err) {} finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [categoryFilter]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/fees/structures", {
        ...form, amount: parseFloat(form.amount), dueDay: parseInt(form.dueDay),
        lateFeeValue: parseFloat(form.lateFeeValue),
      });
      setShowModal(false);
      fetchData();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  // Assigning fees (to a whole class or to specific students) now lives
  // on its own dedicated tab - jump there with this structure preselected.
  const goToAssign = (structureId: string) => {
    router.push(`/dashboard/fees/assign?structureId=${structureId}`);
  };

  const [showEditModal, setShowEditModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    amount: "", frequency: "MONTHLY", dueDay: "10", lateFeeType: "NONE", lateFeeValue: "0", isActive: true,
  });

  const openEditModal = (s: FeeStructure) => {
    setEditingId(s.id);
    setEditForm({
      amount: String(s.amount),
      frequency: s.frequency,
      dueDay: String(s.dueDay),
      lateFeeType: s.lateFeeType,
      lateFeeValue: String(s.lateFeeValue),
      isActive: s.isActive,
    });
    setShowEditModal(true);
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) return;
    try {
      await api.put(`/fees/structures/${editingId}`, {
        amount: parseFloat(editForm.amount),
        frequency: editForm.frequency,
        dueDay: parseInt(editForm.dueDay),
        lateFeeType: editForm.lateFeeType,
        lateFeeValue: parseFloat(editForm.lateFeeValue),
        isActive: editForm.isActive,
      });
      setShowEditModal(false);
      setEditingId(null);
      fetchData();
    } catch (err: any) { alert(err.response?.data?.message || "Failed to update fee structure"); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this fee structure? This cannot be undone.")) return;
    try {
      await api.delete(`/fees/structures/${id}`);
      fetchData();
    } catch (err: any) { alert(err.response?.data?.message || "Cannot delete this fee structure"); }
  };

  // Bulk Create - "same category/amount across multiple classes for a
  // session in one call", via the new bulkCreateFeeStructure endpoint
  // (createFeeStructure only ever handled one class at a time before).
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkForm, setBulkForm] = useState({
    classIds: [] as string[], feeCategoryId: "", academicYearId: "",
    amount: "", frequency: "MONTHLY", dueDay: "10", lateFeeType: "NONE", lateFeeValue: "0",
  });
  const [bulkCreating, setBulkCreating] = useState(false);
  const [bulkCreateResult, setBulkCreateResult] = useState<{ created: number; skipped: number } | null>(null);

  const openBulkCreate = () => {
    setBulkForm({ classIds: [], feeCategoryId: "", academicYearId: "", amount: "", frequency: "MONTHLY", dueDay: "10", lateFeeType: "NONE", lateFeeValue: "0" });
    setBulkCreateResult(null);
    setShowBulkModal(true);
  };

  const toggleBulkClass = (classId: string) => {
    setBulkForm((f) => ({
      ...f,
      classIds: f.classIds.includes(classId) ? f.classIds.filter((id) => id !== classId) : [...f.classIds, classId],
    }));
  };

  const handleBulkCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBulkCreating(true);
    try {
      const res = await api.post("/fees/structures/bulk", {
        ...bulkForm, amount: parseFloat(bulkForm.amount), dueDay: parseInt(bulkForm.dueDay),
        lateFeeValue: parseFloat(bulkForm.lateFeeValue),
      });
      setBulkCreateResult(res.data.data);
      fetchData();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to bulk-create fee structures");
    } finally {
      setBulkCreating(false);
    }
  };

  // View Details - drills into one structure's installments plus how
  // many students currently have it assigned, via the new
  // getFeeStructureById endpoint.
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const openDetail = async (id: string) => {
    setDetail({});
    setDetailLoading(true);
    try {
      const res = await api.get(`/fees/structures/${id}`);
      setDetail(res.data.data);
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to load fee structure details");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary-600" /> Fee Structures
          </h1>
          <p className="text-gray-500 mt-1">Class-wise fee configuration</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={openBulkCreate} className="btn-secondary flex items-center gap-2">
            <Users className="h-4 w-4" /> Bulk Create
          </button>
          <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2">
            <Plus className="h-4 w-4" /> Create Structure
          </button>
        </div>
      </div>

      <div className="card mb-4">
        <select className="input-field w-auto" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="">All Fee Categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : (
        <div className="overflow-x-auto card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="px-4 py-3 text-left font-medium text-gray-600">Class</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Category</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Amount</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Frequency</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Late Fee</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Year</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {structures.map((s) => (
                <tr key={s.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">
                    {s.class ? s.class.name : (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full">
                        Transport: {s.transportRoute?.name}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">{s.feeCategory.name}</td>
                  <td className="px-4 py-3 font-semibold text-green-700">{formatCurrency(s.amount)}</td>
                  <td className="px-4 py-3"><span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">{s.frequency}</span></td>
                  <td className="px-4 py-3 text-xs">
                    {s.lateFeeType === "NONE" ? <span className="text-gray-400">None</span> :
                      <span className="text-red-600">{s.lateFeeType === "FIXED" ? `Rs ${s.lateFeeValue}/day` : `${s.lateFeeValue}%`}</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{s.academicYear.name}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {s.classId ? (
                        <button
                          onClick={() => goToAssign(s.id)}
                          className="text-xs text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1"
                        >
                          <UserCheck className="h-3 w-3" /> Assign
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400" title="Transport fees are assigned from the Transport page, to students allocated to this route">
                          Assigned via Transport
                        </span>
                      )}
                      <button onClick={() => openDetail(s.id)} title="View Details" className="text-gray-500 hover:text-gray-700">
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => openEditModal(s)} title="Edit" className="text-gray-500 hover:text-gray-700">
                        <Edit className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => handleDelete(s.id)} title="Delete" className="text-red-500 hover:text-red-700">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {structures.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No fee structures found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Create Fee Structure" size="lg">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Class *</label>
              <select className="input-field" value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })} required>
                <option value="">Select</option>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fee Category *</label>
              <select className="input-field" value={form.feeCategoryId} onChange={(e) => setForm({ ...form, feeCategoryId: e.target.value })} required>
                <option value="">Select</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Academic Year *</label>
              <select className="input-field" value={form.academicYearId} onChange={(e) => setForm({ ...form, academicYearId: e.target.value })} required>
                <option value="">Select</option>
                {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount (Rs) *</label>
              <input type="number" className="input-field" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Frequency *</label>
              <select className="input-field" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
                <option value="MONTHLY">Monthly</option>
                <option value="QUARTERLY">Quarterly</option>
                <option value="HALF_YEARLY">Half Yearly</option>
                <option value="YEARLY">Yearly</option>
                <option value="ONE_TIME">One Time</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Due Day (of month)</label>
              <input type="number" min="1" max="28" className="input-field" value={form.dueDay} onChange={(e) => setForm({ ...form, dueDay: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Late Fee Type</label>
              <select className="input-field" value={form.lateFeeType} onChange={(e) => setForm({ ...form, lateFeeType: e.target.value })}>
                <option value="NONE">None</option>
                <option value="FIXED">Fixed (Rs/day)</option>
                <option value="PERCENTAGE">Percentage (%)</option>
              </select>
            </div>
            {form.lateFeeType !== "NONE" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Late Fee Value</label>
                <input type="number" className="input-field" value={form.lateFeeValue} onChange={(e) => setForm({ ...form, lateFeeValue: e.target.value })} />
              </div>
            )}
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">Create</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={showEditModal} onClose={() => setShowEditModal(false)} title="Edit Fee Structure" size="lg">
        <form onSubmit={handleUpdate} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount (Rs) *</label>
              <input type="number" className="input-field" value={editForm.amount} onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Frequency *</label>
              <select className="input-field" value={editForm.frequency} onChange={(e) => setEditForm({ ...editForm, frequency: e.target.value })}>
                <option value="MONTHLY">Monthly</option>
                <option value="QUARTERLY">Quarterly</option>
                <option value="HALF_YEARLY">Half Yearly</option>
                <option value="YEARLY">Yearly</option>
                <option value="ONE_TIME">One Time</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Due Day (of month)</label>
              <input type="number" min="1" max="28" className="input-field" value={editForm.dueDay} onChange={(e) => setEditForm({ ...editForm, dueDay: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Late Fee Type</label>
              <select className="input-field" value={editForm.lateFeeType} onChange={(e) => setEditForm({ ...editForm, lateFeeType: e.target.value })}>
                <option value="NONE">None</option>
                <option value="FIXED">Fixed (Rs/day)</option>
                <option value="PERCENTAGE">Percentage (%)</option>
              </select>
            </div>
            {editForm.lateFeeType !== "NONE" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Late Fee Value</label>
                <input type="number" className="input-field" value={editForm.lateFeeValue} onChange={(e) => setEditForm({ ...editForm, lateFeeValue: e.target.value })} />
              </div>
            )}
            <div className="flex items-center gap-2 mt-6">
              <input
                type="checkbox"
                id="structureIsActive"
                checked={editForm.isActive}
                onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })}
              />
              <label htmlFor="structureIsActive" className="text-sm font-medium">Active</label>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setShowEditModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">Save Changes</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!detail} onClose={() => setDetail(null)} title="Fee Structure Details">
        {detailLoading ? (
          <div className="flex justify-center py-8"><div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
        ) : detail ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-gray-500">Class / Route</p><p className="font-medium">{detail.class?.name || detail.transportRoute?.name}</p></div>
              <div><p className="text-gray-500">Category</p><p className="font-medium">{detail.feeCategory?.name}</p></div>
              <div><p className="text-gray-500">Amount</p><p className="font-medium">{formatCurrency(detail.amount)}</p></div>
              <div><p className="text-gray-500">Frequency</p><p className="font-medium">{detail.frequency}</p></div>
              <div><p className="text-gray-500">Academic Year</p><p className="font-medium">{detail.academicYear?.name}</p></div>
              <div><p className="text-gray-500">Students Assigned</p><p className="font-medium">{detail.assignedStudentCount}</p></div>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-gray-600 mb-2">Installments</h4>
              {detail.installments?.length > 0 ? (
                <div className="space-y-1.5">
                  {detail.installments.map((inst: any) => (
                    <div key={inst.installmentNo} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded-lg text-sm">
                      <span>Installment {inst.installmentNo}</span>
                      <span className="font-medium">{formatCurrency(inst.amount)}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-gray-400">No installments configured - full amount due at once.</p>}
            </div>
            <div className="flex justify-end pt-2 border-t">
              <button type="button" onClick={() => setDetail(null)} className="btn-secondary">Close</button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal isOpen={showBulkModal} onClose={() => setShowBulkModal(false)} title="Bulk Create Fee Structure" size="lg">
        <form onSubmit={handleBulkCreate} className="space-y-4">
          {bulkCreateResult && (
            <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-3 py-2">
              Created for {bulkCreateResult.created} class(es){bulkCreateResult.skipped > 0 ? `, ${bulkCreateResult.skipped} already had this category+year` : ""}.
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Classes *</label>
            <div className="grid grid-cols-3 gap-2 max-h-40 overflow-y-auto border rounded-lg p-2">
              {classes.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={bulkForm.classIds.includes(c.id)} onChange={() => toggleBulkClass(c.id)} />
                  {c.name}
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fee Category *</label>
              <select className="input-field" value={bulkForm.feeCategoryId} onChange={(e) => setBulkForm({ ...bulkForm, feeCategoryId: e.target.value })} required>
                <option value="">Select</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Academic Year *</label>
              <select className="input-field" value={bulkForm.academicYearId} onChange={(e) => setBulkForm({ ...bulkForm, academicYearId: e.target.value })} required>
                <option value="">Select</option>
                {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount (Rs) *</label>
              <input type="number" className="input-field" value={bulkForm.amount} onChange={(e) => setBulkForm({ ...bulkForm, amount: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Frequency *</label>
              <select className="input-field" value={bulkForm.frequency} onChange={(e) => setBulkForm({ ...bulkForm, frequency: e.target.value })}>
                <option value="MONTHLY">Monthly</option>
                <option value="QUARTERLY">Quarterly</option>
                <option value="HALF_YEARLY">Half Yearly</option>
                <option value="YEARLY">Yearly</option>
                <option value="ONE_TIME">One Time</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setShowBulkModal(false)} className="btn-secondary">Close</button>
            <button type="submit" disabled={bulkCreating || bulkForm.classIds.length === 0} className="btn-primary disabled:opacity-50">
              {bulkCreating ? "Creating..." : `Create for ${bulkForm.classIds.length} Class(es)`}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
