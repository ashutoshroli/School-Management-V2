"use client";

import { useState, useEffect } from "react";
import { FileText, Plus, Users, Edit, Trash2, ChevronDown, UserCheck, Search } from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";
import { formatCurrency } from "@/lib/utils";

interface FeeStructure {
  id: string;
  classId: string;
  amount: number;
  frequency: string;
  dueDay: number;
  lateFeeType: string;
  lateFeeValue: number;
  isActive: boolean;
  feeCategory: { name: string; code: string };
  class: { name: string };
  academicYear: { name: string };
  installments: { installmentNo: number; amount: number; dueDate: string }[];
}

interface StudentOption {
  id: string;
  admissionNo: string;
  rollNo: string | null;
  user: { name: string };
  class: { name: string } | null;
  section: { name: string } | null;
}

export default function FeeStructuresPage() {
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

  const fetchData = async () => {
    try {
      setLoading(true);
      const [sRes, cRes, catRes, yRes] = await Promise.all([
        api.get("/fees/structures"),
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

  useEffect(() => { fetchData(); }, []);

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

  const bulkAssign = async (structureId: string, classId: string) => {
    if (!confirm("Assign this fee to ALL active students of this class?")) return;
    try {
      const res = await api.post("/fees/assign/bulk", { feeStructureId: structureId, classId });
      alert(res.data.message);
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  // --- "Assign" split-button: Whole Class (existing bulkAssign above)
  // or Specific Students (new picker modal below) ---
  const [assignMenuOpenFor, setAssignMenuOpenFor] = useState<string | null>(null);

  const [showPickerModal, setShowPickerModal] = useState(false);
  const [pickerStructure, setPickerStructure] = useState<FeeStructure | null>(null);
  const [pickerSectionId, setPickerSectionId] = useState("");
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerStudents, setPickerStudents] = useState<StudentOption[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
  const [assigningStudents, setAssigningStudents] = useState(false);
  const [pickerClassSections, setPickerClassSections] = useState<any[]>([]);

  const openStudentPicker = (structure: FeeStructure) => {
    setPickerStructure(structure);
    setPickerSectionId("");
    setPickerSearch("");
    setSelectedStudentIds(new Set());
    const cls = classes.find((c: any) => c.id === structure.classId);
    setPickerClassSections(cls?.sections || []);
    setShowPickerModal(true);
  };

  const fetchPickerStudents = async () => {
    if (!pickerStructure) return;
    setPickerLoading(true);
    try {
      const res = await api.get("/students", {
        params: {
          classId: pickerStructure.classId,
          sectionId: pickerSectionId || undefined,
          search: pickerSearch || undefined,
          limit: 100,
        },
      });
      setPickerStudents(res.data.data || []);
    } catch {
      setPickerStudents([]);
    } finally {
      setPickerLoading(false);
    }
  };

  useEffect(() => {
    if (showPickerModal) fetchPickerStudents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPickerModal, pickerSectionId]);

  const toggleStudentSelected = (id: string) => {
    setSelectedStudentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    setSelectedStudentIds((prev) => {
      const allVisibleSelected = pickerStudents.every((s) => prev.has(s.id));
      const next = new Set(prev);
      if (allVisibleSelected) {
        pickerStudents.forEach((s) => next.delete(s.id));
      } else {
        pickerStudents.forEach((s) => next.add(s.id));
      }
      return next;
    });
  };

  const handleAssignToSelectedStudents = async () => {
    if (!pickerStructure || selectedStudentIds.size === 0) return;
    setAssigningStudents(true);
    try {
      const res = await api.post("/fees/assign/students", {
        feeStructureId: pickerStructure.id,
        studentIds: Array.from(selectedStudentIds),
      });
      alert(res.data.message);
      setShowPickerModal(false);
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to assign fees to selected students");
    } finally {
      setAssigningStudents(false);
    }
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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary-600" /> Fee Structures
          </h1>
          <p className="text-gray-500 mt-1">Class-wise fee configuration</p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2">
          <Plus className="h-4 w-4" /> Create Structure
        </button>
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
                  <td className="px-4 py-3 font-medium">{s.class.name}</td>
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
                      <div className="relative">
                        <button
                          onClick={() => setAssignMenuOpenFor(assignMenuOpenFor === s.id ? null : s.id)}
                          className="text-xs text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1"
                        >
                          <Users className="h-3 w-3" /> Assign <ChevronDown className="h-3 w-3" />
                        </button>
                        {assignMenuOpenFor === s.id && (
                          <>
                            {/* Backdrop to close the menu on outside click */}
                            <div className="fixed inset-0 z-10" onClick={() => setAssignMenuOpenFor(null)} />
                            <div className="absolute left-0 top-full mt-1 z-20 bg-white border rounded-lg shadow-lg w-52 overflow-hidden">
                              <button
                                onClick={() => { setAssignMenuOpenFor(null); bulkAssign(s.id, s.classId); }}
                                className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center gap-2"
                              >
                                <Users className="h-3.5 w-3.5 text-gray-400" /> Assign to Entire Class
                              </button>
                              <button
                                onClick={() => { setAssignMenuOpenFor(null); openStudentPicker(s); }}
                                className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center gap-2 border-t"
                              >
                                <UserCheck className="h-3.5 w-3.5 text-gray-400" /> Assign to Specific Students
                              </button>
                            </div>
                          </>
                        )}
                      </div>
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

      <Modal
        isOpen={showPickerModal}
        onClose={() => setShowPickerModal(false)}
        title={pickerStructure ? `Assign "${pickerStructure.feeCategory.name}" to Specific Students` : "Assign to Specific Students"}
        size="lg"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Only students in <span className="font-medium">{pickerStructure?.class.name}</span> are shown - narrow down by section or search, then tick the students who should get this fee.
          </p>

          <div className="flex flex-wrap gap-3">
            <select className="input-field w-auto" value={pickerSectionId} onChange={(e) => setPickerSectionId(e.target.value)}>
              <option value="">All Sections</option>
              {pickerClassSections.map((sec: any) => <option key={sec.id} value={sec.id}>{sec.name}</option>)}
            </select>
            <div className="relative flex-1 min-w-[180px]">
              <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                className="input-field pl-9 w-full"
                placeholder="Search by name, admission no, roll no..."
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && fetchPickerStudents()}
              />
            </div>
            <button type="button" onClick={fetchPickerStudents} className="btn-secondary text-sm">Search</button>
          </div>

          <div className="border rounded-lg max-h-80 overflow-y-auto">
            {pickerLoading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" />
              </div>
            ) : pickerStudents.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-8">No students found</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50">
                  <tr className="border-b">
                    <th className="px-3 py-2 text-left w-10">
                      <input
                        type="checkbox"
                        checked={pickerStudents.length > 0 && pickerStudents.every((s) => selectedStudentIds.has(s.id))}
                        onChange={toggleSelectAllVisible}
                      />
                    </th>
                    <th className="px-3 py-2 text-left">Admission No</th>
                    <th className="px-3 py-2 text-left">Name</th>
                    <th className="px-3 py-2 text-left">Section</th>
                    <th className="px-3 py-2 text-left">Roll No</th>
                  </tr>
                </thead>
                <tbody>
                  {pickerStudents.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => toggleStudentSelected(s.id)}
                      className={`border-b cursor-pointer hover:bg-gray-50 ${selectedStudentIds.has(s.id) ? "bg-primary-50" : ""}`}
                    >
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selectedStudentIds.has(s.id)} onChange={() => toggleStudentSelected(s.id)} />
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{s.admissionNo}</td>
                      <td className="px-3 py-2 font-medium">{s.user.name}</td>
                      <td className="px-3 py-2 text-gray-500">{s.section?.name || "-"}</td>
                      <td className="px-3 py-2 text-gray-500">{s.rollNo || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="flex items-center justify-between pt-4 border-t">
            <span className="text-sm text-gray-500">{selectedStudentIds.size} student(s) selected</span>
            <div className="flex gap-3">
              <button type="button" onClick={() => setShowPickerModal(false)} className="btn-secondary">Cancel</button>
              <button
                type="button"
                onClick={handleAssignToSelectedStudents}
                disabled={selectedStudentIds.size === 0 || assigningStudents}
                className="btn-primary disabled:opacity-50"
              >
                {assigningStudents ? "Assigning..." : `Assign to ${selectedStudentIds.size || ""} Student(s)`}
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
