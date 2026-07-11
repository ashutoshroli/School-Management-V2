"use client";

import { useState, useEffect } from "react";
import { GraduationCap, Plus, Search, Eye, Filter, BadgeCheck } from "lucide-react";
import Link from "next/link";
import api from "@/lib/api";
import DataTable from "@/components/ui/DataTable";
import ErrorBanner from "@/components/ui/ErrorBanner";
import { openPdfInNewTab } from "@/lib/pdf";

interface Student {
  id: string;
  admissionNo: string;
  rollNo: string;
  user: { name: string; email: string; phone: string; avatar: string | null };
  class: { name: string };
  section: { name: string };
  isActive: boolean;
}

export default function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [classFilter, setClassFilter] = useState("");
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchStudents = async () => {
    try {
      setLoading(true);
      setError(null);
      const params: any = { page, limit: 25 };
      if (search) params.search = search;
      if (classFilter) params.classId = classFilter;
      const res = await api.get("/students", { params });
      setStudents(res.data.data || []);
      setTotalPages(res.data.pagination?.totalPages || 1);
    } catch (err: any) {
      console.error("Failed to fetch students", err);
      setError(err.response?.data?.message || "Failed to load students. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const fetchClasses = async () => {
    try {
      const res = await api.get("/classes");
      setClasses(res.data.data || []);
    } catch (err) {}
  };

  useEffect(() => { fetchClasses(); }, []);
  useEffect(() => { fetchStudents(); }, [page, search, classFilter]);

  const columns = [
    { key: "admissionNo", label: "Adm. No", render: (s: Student) => <span className="font-mono text-xs">{s.admissionNo}</span> },
    { key: "name", label: "Student Name", render: (s: Student) => <span className="font-medium">{s.user.name}</span> },
    { key: "class", label: "Class", render: (s: Student) => `${s.class.name} - ${s.section.name}` },
    { key: "phone", label: "Phone", render: (s: Student) => s.user.phone || "-" },
    { key: "email", label: "Email", render: (s: Student) => <span className="text-xs">{s.user.email}</span> },
    {
      key: "status", label: "Status",
      render: (s: Student) => (
        <span className={`px-2 py-0.5 rounded-full text-xs ${s.isActive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
          {s.isActive ? "Active" : "Left"}
        </span>
      ),
    },
    {
      key: "actions", label: "",
      render: (s: Student) => (
        <Link href={`/dashboard/students/${s.id}`} className="p-1 rounded hover:bg-gray-100 inline-block">
          <Eye className="h-4 w-4 text-primary-600" />
        </Link>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <GraduationCap className="h-6 w-6 text-primary-600" /> Students
          </h1>
          <p className="text-gray-500 mt-1">Manage student records</p>
        </div>
        <Link href="/dashboard/students/new" className="btn-primary flex items-center gap-2">
          <Plus className="h-4 w-4" /> New Admission
        </Link>
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="flex flex-wrap gap-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              className="input-field pl-10"
              placeholder="Search by name, admission no., email..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <select
            className="input-field w-auto"
            value={classFilter}
            onChange={(e) => { setClassFilter(e.target.value); setPage(1); }}
          >
            <option value="">All Classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {classFilter && (
            <button
              onClick={() => openPdfInNewTab(`/students/id-cards/batch?classId=${classFilter}`)}
              className="btn-secondary flex items-center gap-2"
              title="Download ID cards for every active student in this class"
            >
              <BadgeCheck className="h-4 w-4" /> Batch ID Cards
            </button>
          )}
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchStudents} />}

      {/* Table */}
      <div className="card">
        <DataTable
          columns={columns}
          data={students}
          loading={loading}
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          emptyMessage="No students found"
        />
      </div>
    </div>
  );
}
