"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Inbox, Download, Trash2, UserPlus, Eye } from "lucide-react";
import api from "@/lib/api";
import { formatDate } from "@/lib/utils";
import DataTable from "@/components/ui/DataTable";
import ErrorBanner from "@/components/ui/ErrorBanner";
import Modal from "@/components/ui/Modal";
import { openPdfInNewTab } from "@/lib/pdf";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";

const STATUS_COLORS: Record<string, string> = {
  NEW: "bg-blue-100 text-blue-700",
  CONTACTED: "bg-yellow-100 text-yellow-700",
  ADMITTED: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-700",
};

export default function AdmissionInquiriesPage() {
  const router = useRouter();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const { canDelete } = usePermissions();
  const [inquiries, setInquiries] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  // classAppliedFor + date-range filter - previously impossible on the
  // backend (only status existed).
  const [classAppliedForFilter, setClassAppliedForFilter] = useState("");
  const [fromDateFilter, setFromDateFilter] = useState("");
  const [toDateFilter, setToDateFilter] = useState("");
  // Branch filter (Super Admin only) - the backend now shows inquiries
  // across EVERY branch for a Super Admin by default (see
  // getAdmissionInquiries's doc comment - a publicly-submitted inquiry
  // for a branch other than the admin's current session branch used to
  // be silently invisible), with this dropdown available to narrow
  // back down to one branch if desired. Branch Admins never see this -
  // they're always locked to their own branch server-side regardless.
  const [branchFilter, setBranchFilter] = useState("");
  const [branches, setBranches] = useState<any[]>([]);

  const fetchInquiries = async () => {
    setLoading(true);
    setError(null);
    try {
      const params: any = { page, limit: 20 };
      if (statusFilter) params.status = statusFilter;
      if (classAppliedForFilter) params.classAppliedFor = classAppliedForFilter;
      if (fromDateFilter) params.fromDate = fromDateFilter;
      if (toDateFilter) params.toDate = toDateFilter;
      if (isSuperAdmin && branchFilter) params.branchId = branchFilter;
      const res = await api.get("/admission/inquiries", { params });
      setInquiries(res.data.data || []);
      setTotalPages(res.data.pagination?.totalPages || 1);
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to load inquiries");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInquiries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, statusFilter, classAppliedForFilter, fromDateFilter, toDateFilter, branchFilter]);

  useEffect(() => {
    if (isSuperAdmin) {
      api.get("/branches").then((res) => setBranches(res.data.data || [])).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin]);

  const updateStatus = async (id: string, status: string) => {
    try {
      await api.patch(`/admission/inquiries/${id}/status`, { status });
      await fetchInquiries();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to update status");
    }
  };

  // Convert an inquiry into the New Student Admission form, pre-filled
  // via query params. `classAppliedFor` is free text on the inquiry
  // (not a classId FK), so it can't be mapped to a real class - the
  // new-student form leaves Class/Section blank for the admin to pick,
  // but shows the applied-for text as a hint.
  const convertToStudent = (inquiry: any) => {
    const params = new URLSearchParams();
    params.set("fromInquiryId", inquiry.id);
    if (inquiry.studentName) params.set("name", inquiry.studentName);
    if (inquiry.dateOfBirth) params.set("dateOfBirth", inquiry.dateOfBirth.slice(0, 10));
    if (inquiry.gender) params.set("gender", inquiry.gender);
    if (inquiry.classAppliedFor) params.set("classAppliedFor", inquiry.classAppliedFor);
    if (inquiry.parentName) params.set("fatherName", inquiry.parentName);
    if (inquiry.parentEmail) params.set("fatherEmail", inquiry.parentEmail);
    if (inquiry.parentPhone) params.set("fatherPhone", inquiry.parentPhone);
    if (inquiry.address) params.set("address", inquiry.address);
    if (inquiry.previousSchool) params.set("previousSchool", inquiry.previousSchool);
    router.push(`/dashboard/students/new?${params.toString()}`);
  };

  const handleDelete = async (id: string, studentName: string) => {
    if (!confirm(`Delete inquiry for "${studentName}"?`)) return;
    try {
      await api.delete(`/admission/inquiries/${id}`);
      await fetchInquiries();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to delete inquiry");
    }
  };

  // View Details - the only prior way to see one inquiry's full
  // detail was the PDF export; this uses the new getAdmissionInquiryById
  // for a quick in-app look without generating a PDF.
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const openDetail = async (id: string) => {
    setDetail({});
    setDetailLoading(true);
    try {
      const res = await api.get(`/admission/inquiries/${id}`);
      setDetail(res.data.data);
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to load inquiry details");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const columns = [
    {
      key: "studentName",
      label: "Student",
      render: (i: any) => (
        <div>
          <p className="font-medium">{i.studentName}</p>
          <p className="text-xs text-gray-500">Applying for: {i.classAppliedFor}</p>
        </div>
      ),
    },
    {
      key: "parentName",
      label: "Parent/Guardian",
      render: (i: any) => (
        <div>
          <p>{i.parentName}</p>
          <p className="text-xs text-gray-500">{i.parentPhone} &bull; {i.parentEmail}</p>
        </div>
      ),
    },
    // Branch column - only meaningful (and only shown) for a Super
    // Admin, since inquiries across every branch can now appear in the
    // same list (see the branch-visibility fix above); a Branch Admin
    // only ever sees their own single branch's inquiries, so a
    // per-row branch label would be redundant noise for them.
    ...(isSuperAdmin
      ? [{
          key: "branch",
          label: "Branch",
          render: (i: any) => <span className="text-xs text-gray-500">{i.branch?.name || "-"}</span>,
        }]
      : []),
    {
      key: "createdAt",
      label: "Submitted",
      render: (i: any) => <span className="text-xs text-gray-500">{formatDate(i.createdAt)}</span>,
    },
    {
      key: "status",
      label: "Status",
      render: (i: any) => (
        <select
          value={i.status}
          onChange={(e) => updateStatus(i.id, e.target.value)}
          className={`px-2 py-1 rounded-lg text-xs font-medium border-0 ${STATUS_COLORS[i.status] || "bg-gray-100"}`}
        >
          <option value="NEW">New</option>
          <option value="CONTACTED">Contacted</option>
          <option value="ADMITTED">Admitted</option>
          <option value="REJECTED">Rejected</option>
        </select>
      ),
    },
    {
      key: "actions",
      label: "Actions",
      render: (i: any) => (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => openDetail(i.id)}
            className="text-gray-500 hover:text-gray-700"
            title="View Details"
          >
            <Eye className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => convertToStudent(i)}
            className="text-green-600 hover:text-green-700"
            title="Convert to Student (opens New Admission form pre-filled)"
          >
            <UserPlus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => openPdfInNewTab(`/admission/inquiries/${i.id}/pdf`)}
            className="text-primary-600 hover:text-primary-700"
            title="Download admission form PDF"
          >
            <Download className="h-4 w-4" />
          </button>
          {canDelete && (
            <button
              type="button"
              onClick={() => handleDelete(i.id, i.studentName)}
              className="text-red-500 hover:text-red-700"
              title="Delete inquiry"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Inbox className="h-6 w-6 text-primary-600" /> Admission Inquiries
          </h1>
          <p className="text-gray-500 mt-1">Submissions from the public admission form</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isSuperAdmin && (
            <select className="input-field w-auto" value={branchFilter} onChange={(e) => { setBranchFilter(e.target.value); setPage(1); }} title="Filter by branch">
              <option value="">All branches</option>
              {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <select className="input-field w-auto" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            <option value="NEW">New</option>
            <option value="CONTACTED">Contacted</option>
            <option value="ADMITTED">Admitted</option>
            <option value="REJECTED">Rejected</option>
          </select>
          <input
            className="input-field w-auto"
            placeholder="Class applied for..."
            value={classAppliedForFilter}
            onChange={(e) => { setClassAppliedForFilter(e.target.value); setPage(1); }}
          />
          <input type="date" className="input-field w-auto" value={fromDateFilter} onChange={(e) => { setFromDateFilter(e.target.value); setPage(1); }} title="From date" />
          <input type="date" className="input-field w-auto" value={toDateFilter} onChange={(e) => { setToDateFilter(e.target.value); setPage(1); }} title="To date" />
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchInquiries} />}

      <div className="card">
        <DataTable columns={columns} data={inquiries} loading={loading} page={page} totalPages={totalPages} onPageChange={setPage} emptyMessage="No admission inquiries yet" />
      </div>

      <Modal isOpen={!!detail} onClose={() => setDetail(null)} title={detail?.studentName ? `Inquiry - ${detail.studentName}` : "Inquiry Details"}>
        {detailLoading ? (
          <div className="flex justify-center py-8"><div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
        ) : detail ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-gray-500">Date of Birth</p><p className="font-medium">{detail.dateOfBirth ? formatDate(detail.dateOfBirth) : "-"}</p></div>
              <div><p className="text-gray-500">Gender</p><p className="font-medium">{detail.gender}</p></div>
              <div><p className="text-gray-500">Class Applied For</p><p className="font-medium">{detail.classAppliedFor}</p></div>
              <div><p className="text-gray-500">Branch</p><p className="font-medium">{detail.branch?.name}</p></div>
              <div><p className="text-gray-500">Parent/Guardian</p><p className="font-medium">{detail.parentName}</p></div>
              <div><p className="text-gray-500">Contact</p><p className="font-medium">{detail.parentPhone} / {detail.parentEmail}</p></div>
              <div><p className="text-gray-500">Previous School</p><p className="font-medium">{detail.previousSchool || "-"}</p></div>
              <div><p className="text-gray-500">Status</p><p className="font-medium">{detail.status}</p></div>
            </div>
            {detail.address && <div><p className="text-gray-500 text-sm">Address</p><p className="text-sm font-medium">{detail.address}</p></div>}
            {detail.message && <div><p className="text-gray-500 text-sm">Message</p><p className="text-sm">{detail.message}</p></div>}
            {detail.reviewNotes && <div><p className="text-gray-500 text-sm">Review Notes</p><p className="text-sm">{detail.reviewNotes}</p></div>}
            <div className="flex justify-end pt-2 border-t">
              <button type="button" onClick={() => setDetail(null)} className="btn-secondary">Close</button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
