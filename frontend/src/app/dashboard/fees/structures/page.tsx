"use client";

import { useState, useEffect } from "react";
import { FileText, Plus, Users } from "lucide-react";
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
                    <button onClick={() => bulkAssign(s.id, s.classId)} className="text-xs text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1">
                      <Users className="h-3 w-3" /> Assign
                    </button>
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
    </div>
  );
}
