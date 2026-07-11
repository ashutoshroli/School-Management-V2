"use client";

import { useState, useEffect } from "react";
import { Percent, ToggleLeft, ToggleRight, Trash2, Filter, Eye } from "lucide-react";
import Link from "next/link";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";
import { formatCurrency, formatDate } from "@/lib/utils";

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
  const [discounts, setDiscounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchDiscounts = async () => {
    setLoading(true);
    try {
      const res = await api.get("/fees/discounts", {
        params: { type: typeFilter || undefined, includeInactive: includeInactive ? "true" : undefined },
      });
      setDiscounts(res.data.data || []);
    } catch {
      setDiscounts([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { fetchDiscounts(); }, [typeFilter, includeInactive]);

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
          Branch-wide view of every discount/scholarship currently granted. To add a new discount, open the
          student's profile.
        </p>
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
                      <button
                        onClick={() => remove(d.id, d.student.user.name)}
                        disabled={deletingId === d.id}
                        title="Remove"
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded disabled:opacity-40"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
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
    </div>
  );
}
