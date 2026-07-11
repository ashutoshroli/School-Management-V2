"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Inbox, Download, Trash2, UserPlus } from "lucide-react";
import api from "@/lib/api";
import { formatDate } from "@/lib/utils";
import DataTable from "@/components/ui/DataTable";
import ErrorBanner from "@/components/ui/ErrorBanner";
import { openPdfInNewTab } from "@/lib/pdf";

const STATUS_COLORS: Record<string, string> = {
  NEW: "bg-blue-100 text-blue-700",
  CONTACTED: "bg-yellow-100 text-yellow-700",
  ADMITTED: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-700",
};

export default function AdmissionInquiriesPage() {
  const router = useRouter();
  const [inquiries, setInquiries] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");

  const fetchInquiries = async () => {
    setLoading(true);
    setError(null);
    try {
      const params: any = { page, limit: 20 };
      if (statusFilter) params.status = statusFilter;
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
  }, [page, statusFilter]);

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
          <button
            type="button"
            onClick={() => handleDelete(i.id, i.studentName)}
            className="text-red-500 hover:text-red-700"
            title="Delete inquiry"
          >
            <Trash2 className="h-4 w-4" />
          </button>
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
        <select className="input-field w-auto" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          <option value="NEW">New</option>
          <option value="CONTACTED">Contacted</option>
          <option value="ADMITTED">Admitted</option>
          <option value="REJECTED">Rejected</option>
        </select>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchInquiries} />}

      <div className="card">
        <DataTable columns={columns} data={inquiries} loading={loading} page={page} totalPages={totalPages} onPageChange={setPage} emptyMessage="No admission inquiries yet" />
      </div>
    </div>
  );
}
