"use client";

import { useState, useEffect } from "react";
import { Percent, ToggleLeft, ToggleRight, Trash2, Filter, Eye, Users } from "lucide-react";
import Link from "next/link";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";
import { formatCurrency, formatDate } from "@/lib/utils";
import { usePermissions } from "@/hooks/usePermissions";

const DISCOUNT_TYPES = ["SIBLING", "MERIT_SCHOLARSHIP", "RTE", "STAFF_WARD", "CUSTOM"];

/**
 * Branch-wide discount/scholarship overview - the counterpart to
 * students/[id]'s per-student discount card. Lets an accountant see
 * (and audit) every concession currently granted across the whole
 * branch, rather than having to open each student's profile one at a
 * time. Uses GET /fees/discounts (getAllDiscounts) - new in this
 * phase, alongside the existing per-student endpoints reused for
 * toggle/delete.
 */
export default function FeeDiscountsPage() {
  const { canDelete } = usePermissions();
  const [discounts, setDiscounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [sectionFilter, setSectionFilter] = useState("");
  const [classes, setClasses] = useState<any[]>([]);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    api.get("/classes").then((res) => setClasses(res.data.data || [])).catch(() => {});
  }, []);

  const sectionsForSelectedClass = classes.find((c) => c.id === classFilter)?.sections || [];

  const fetchDiscounts = async () => {
    setLoading(true);
    try {
      const res = await api.get("/fees/discounts", {
        params: {
          type: typeFilter || undefined,
          classId: classFilter || undefined,
          sectionId: sectionFilter || undefined,
          includeInactive: includeInactive ? "true" : undefined,
        },
      });
      setDiscounts(res.data.data || []);
    } catch {
      setDiscounts([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { fetchDiscounts(); }, [typeFilter, classFilter, sectionFilter, includeInactive]);

  const toggle = async (id: string) => {
    setTogglingId(id);
    try {
      await api.patch(`/fees/discounts/${id}/toggle`);
      fetchDiscounts();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to toggle discount");
    } finally {
      setTogglingId(null);
    }
  };

  const remove = async (id: string, studentName: string) => {
    if (!confirm(`Remove this discount for ${studentName}?`)) return;
    setDeletingId(id);
    try {
      await api.delete(`/fees/discounts/${id}`);
      fetchDiscounts();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to remove discount");
    } finally {
      setDeletingId(null);
    }
  };

  const activeCount = discounts.filter((d) => d.isActive).length;

  // Bulk Assign - "give this scholarship to all Class 10 students" in
  // one call, via the new bulkAssignDiscount endpoint. A single
  // discount up to now had to be granted one student at a time from
  // their profile page.
  const [showBulkModal, setShowBulkModal] = useState(false);
  // BUG FIX: feeStructureId is now required - each matched student's
  // OWN assignment for this specific fee structure is what actually
  // gets discounted server-side (see bulkAssignDiscount's doc comment
  // in discount.controller.ts); without it, the discount had nothing
  // to link to and never reduced anything a student owed.
  const [bulkForm, setBulkForm] = useState({ classId: "", sectionId: "", feeStructureId: "", type: "MERIT_SCHOLARSHIP", name: "", value: "", isPercent: true });
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState("");
  const [bulkResult, setBulkResult] = useState<{ assigned: number; skipped: number; total: number } | null>(null);
  const bulkSections = classes.find((c) => c.id === bulkForm.classId)?.sections || [];
  const [feeStructures, setFeeStructures] = useState<any[]>([]);

  useEffect(() => {
    api.get("/fees/structures").then((res) => setFeeStructures(res.data.data || [])).catch(() => {});
  }, []);

  // Live preview of how many active students the chosen class/section
  // filter actually matches, BEFORE submitting - same pattern already
  // used by the other bulk-action modals in this app (Bulk Create Fee
  // Structure, Bulk Assign Salary, etc), so the submit button here
  // shows a real count instead of the generic "Assign to Matched
  // Students" with no indication of how many students that is.
  // bulkAssignDiscount itself targets the exact same set (active
  // students matching classId/sectionId), so this count matches what
  // the backend will do.
  const [bulkMatchCount, setBulkMatchCount] = useState<number | null>(null);
  const [bulkMatchLoading, setBulkMatchLoading] = useState(false);

  useEffect(() => {
    if (!showBulkModal || (!bulkForm.classId && !bulkForm.sectionId)) { setBulkMatchCount(null); return; }
    setBulkMatchLoading(true);
    api
      .get("/students", { params: { classId: bulkForm.classId || undefined, sectionId: bulkForm.sectionId || undefined, limit: 1 } })
      .then((res) => setBulkMatchCount(res.data.pagination?.total ?? null))
      .catch(() => setBulkMatchCount(null))
      .finally(() => setBulkMatchLoading(false));
  }, [showBulkModal, bulkForm.classId, bulkForm.sectionId]);

  const openBulkModal = () => {
    setBulkForm({ classId: "", sectionId: "", feeStructureId: "", type: "MERIT_SCHOLARSHIP", name: "", value: "", isPercent: true });
    setBulkError("");
    setBulkResult(null);
    setBulkMatchCount(null);
    setShowBulkModal(true);
  };

  const handleBulkAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkForm.feeStructureId) { setBulkError("Select which fee structure this discount applies to"); return; }
    setBulkSaving(true);
    setBulkError("");
    setBulkResult(null);
    try {
      const res = await api.post("/fees/discounts/bulk", {
        classId: bulkForm.classId || undefined,
        sectionId: bulkForm.sectionId || undefined,
        feeStructureId: bulkForm.feeStructureId,
        type: bulkForm.type,
        name: bulkForm.name,
        value: parseFloat(bulkForm.value),
        isPercent: bulkForm.isPercent,
      });
      setBulkResult(res.data.data);
      fetchDiscounts();
    } catch (err: any) {
      setBulkError(err.response?.data?.message || "Failed to bulk-assign discount");
    } finally {
      setBulkSaving(false);
    }
  };

  // View Details - a one-discount detail modal (via the new
  // getDiscountById endpoint), useful when launched from either the
  // branch-wide list here or a future per-student list.
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const openDetail = async (id: string) => {
    setDetail({});
    setDetailLoading(true);
    try {
      const res = await api.get(`/fees/discounts/detail/${id}`);
      setDetail(res.data.data);
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to load discount details");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Percent className="h-6 w-6 text-primary-600" /> Fee Discounts
        </h1>
        <p className="text-gray-500 mt-1">
          Branch-wide view of every discount/scholarship currently granted. To add a discount for one student, open
          their profile - to grant one to a whole class/section at once, use Bulk Assign below.
        </p>
      </div>

      <div className="mb-6">
        <button onClick={openBulkModal} className="btn-primary flex items-center gap-2">
          <Users className="h-4 w-4" /> Bulk Assign Discount
        </button>
      </div>

      <div className="card mb-6 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-gray-400" />
          <select className="input-field w-auto" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All Types</option>
            {DISCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
            ))}
          </select>
        </div>
        <select className="input-field w-auto" value={classFilter} onChange={(e) => { setClassFilter(e.target.value); setSectionFilter(""); }}>
          <option value="">All Classes</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="input-field w-auto" value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)} disabled={!classFilter}>
          <option value="">All Sections</option>
          {sectionsForSelectedClass.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
          Include inactive/removed discounts
        </label>
        {!loading && (
          <span className="text-sm text-gray-500 ml-auto">
            {activeCount} active{includeInactive ? ` / ${discounts.length} total` : ""}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
        </div>
      ) : discounts.length === 0 ? (
        <p className="text-center text-gray-400 py-12">No discounts found for the selected filters</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="px-4 py-3 text-left">Student</th>
                <th className="px-4 py-3 text-left">Class</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-right">Value</th>
                <th className="px-4 py-3 text-left">Granted</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {discounts.map((d) => (
                <tr key={d.id} className={`border-b ${!d.isActive ? "opacity-50" : ""}`}>
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/students/${d.student.id}`} className="font-medium text-primary-600 hover:underline">
                      {d.student.user.name}
                    </Link>
                    <p className="text-xs text-gray-500">{d.student.admissionNo}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{d.student.class?.name}-{d.student.section?.name}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs">{d.type.replace(/_/g, " ")}</span>
                  </td>
                  <td className="px-4 py-3">{d.name}</td>
                  <td className="px-4 py-3 text-right font-medium">
                    {d.isPercent ? `${d.value}%` : formatCurrency(Number(d.value))}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(d.createdAt)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${d.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                      {d.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end items-center gap-1">
                      <button
                        onClick={() => openDetail(d.id)}
                        title="View Details"
                        className="p-1.5 text-gray-500 hover:bg-gray-100 rounded"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => toggle(d.id)}
                        disabled={togglingId === d.id}
                        title={d.isActive ? "Deactivate" : "Activate"}
                        className="p-1.5 text-gray-500 hover:bg-gray-100 rounded disabled:opacity-40"
                      >
                        {d.isActive ? <ToggleRight className="h-4 w-4 text-green-600" /> : <ToggleLeft className="h-4 w-4" />}
                      </button>
                      {canDelete && (
                        <button
                          onClick={() => remove(d.id, d.student.user.name)}
                          disabled={deletingId === d.id}
                          title="Remove"
                          className="p-1.5 text-red-500 hover:bg-red-50 rounded disabled:opacity-40"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={!!detail} onClose={() => setDetail(null)} title="Discount Details">
        {detailLoading ? (
          <div className="flex justify-center py-8"><div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
        ) : detail ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-gray-500">Student</p><p className="font-medium">{detail.student?.user?.name}</p></div>
              <div><p className="text-gray-500">Class</p><p className="font-medium">{detail.student?.class?.name}-{detail.student?.section?.name}</p></div>
              <div><p className="text-gray-500">Type</p><p className="font-medium">{detail.type?.replace(/_/g, " ")}</p></div>
              <div><p className="text-gray-500">Name</p><p className="font-medium">{detail.name}</p></div>
              <div><p className="text-gray-500">Value</p><p className="font-medium">{detail.isPercent ? `${detail.value}%` : formatCurrency(Number(detail.value))}</p></div>
              <div><p className="text-gray-500">Status</p><p className="font-medium">{detail.isActive ? "Active" : "Inactive"}</p></div>
              <div><p className="text-gray-500">Granted</p><p className="font-medium">{detail.createdAt ? formatDate(detail.createdAt) : "-"}</p></div>
            </div>
            <div className="flex justify-end pt-2 border-t">
              <button type="button" onClick={() => setDetail(null)} className="btn-secondary">Close</button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal isOpen={showBulkModal} onClose={() => setShowBulkModal(false)} title="Bulk Assign Discount">
        <form onSubmit={handleBulkAssign} className="space-y-4">
          {bulkError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{bulkError}</div>}
          {bulkResult && (
            <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-3 py-2">
              Assigned to {bulkResult.assigned} of {bulkResult.total} matched student(s).
              {bulkResult.skipped > 0 && ` ${bulkResult.skipped} skipped - no assignment for this fee structure yet.`}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">Fee Structure *</label>
            <select className="input-field" value={bulkForm.feeStructureId} onChange={(e) => setBulkForm({ ...bulkForm, feeStructureId: e.target.value })} required>
              <option value="">Select the fee this discount applies to</option>
              {feeStructures.map((fs: any) => (
                <option key={fs.id} value={fs.id}>
                  {fs.feeCategory?.name} - {fs.class?.name || fs.transportRoute?.name} ({fs.frequency})
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">
              Only students who already have THIS fee assigned to them will receive the discount.
            </p>
          </div>
          <p className="text-xs text-gray-400">Select at least a class (and optionally a section) to target students.</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Class</label>
              <select className="input-field" value={bulkForm.classId} onChange={(e) => setBulkForm({ ...bulkForm, classId: e.target.value, sectionId: "" })}>
                <option value="">All Classes</option>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Section</label>
              <select className="input-field" value={bulkForm.sectionId} onChange={(e) => setBulkForm({ ...bulkForm, sectionId: e.target.value })} disabled={!bulkForm.classId}>
                <option value="">All Sections</option>
                {bulkSections.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
          {(bulkForm.classId || bulkForm.sectionId) && (
            <p className="text-xs text-gray-500">
              {bulkMatchLoading
                ? "Checking how many students match..."
                : bulkMatchCount !== null
                ? `${bulkMatchCount} active student(s) will receive this discount.`
                : "Unable to preview match count."}
            </p>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">Type *</label>
            <select className="input-field" value={bulkForm.type} onChange={(e) => setBulkForm({ ...bulkForm, type: e.target.value })}>
              {DISCOUNT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Discount Name *</label>
            <input className="input-field" placeholder="e.g. Annual Merit Scholarship" value={bulkForm.name} onChange={(e) => setBulkForm({ ...bulkForm, name: e.target.value })} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Value *</label>
              <input type="number" min={0} step="0.01" className="input-field" value={bulkForm.value} onChange={(e) => setBulkForm({ ...bulkForm, value: e.target.value })} required />
            </div>
            <div className="flex items-end pb-2.5">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={bulkForm.isPercent} onChange={(e) => setBulkForm({ ...bulkForm, isPercent: e.target.checked })} />
                Value is a percentage
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t">
            <button type="button" onClick={() => setShowBulkModal(false)} className="btn-secondary">Close</button>
            <button type="submit" disabled={bulkSaving || !bulkForm.feeStructureId || (!bulkForm.classId && !bulkForm.sectionId)} className="btn-primary disabled:opacity-50">
              {bulkSaving ? "Assigning..." : `Assign to Matched Students${bulkMatchCount !== null ? ` (${bulkMatchCount})` : ""}`}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
