"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import api from "@/lib/api";
import { formatDate } from "@/lib/utils";
import DataTable from "@/components/ui/DataTable";
import ErrorBanner from "@/components/ui/ErrorBanner";

const ACTION_COLORS: Record<string, string> = {
  CREATE: "bg-green-100 text-green-700",
  UPDATE: "bg-blue-100 text-blue-700",
  DELETE: "bg-red-100 text-red-700",
};

export default function AuditLogPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [moduleFilter, setModuleFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const params: any = { page, limit: 25 };
      if (moduleFilter) params.module = moduleFilter;
      const res = await api.get("/reports/audit-log", { params });
      setLogs(res.data.data || []);
      setTotalPages(res.data.pagination?.totalPages || 1);
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to load audit log");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, moduleFilter]);

  const columns = [
    {
      key: "createdAt",
      label: "When",
      render: (log: any) => <span className="text-xs text-gray-500">{formatDate(log.createdAt)}</span>,
    },
    {
      key: "user",
      label: "User",
      render: (log: any) => (
        <div>
          <p className="text-sm font-medium">{log.user?.name || "Unknown"}</p>
          <p className="text-xs text-gray-400">{log.user?.role?.replace("_", " ")}</p>
        </div>
      ),
    },
    {
      key: "action",
      label: "Action",
      render: (log: any) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ACTION_COLORS[log.action] || "bg-gray-100 text-gray-600"}`}>
          {log.action}
        </span>
      ),
    },
    { key: "module", label: "Module" },
    {
      key: "entityId",
      label: "Entity",
      render: (log: any) => <span className="font-mono text-xs text-gray-500">{log.entityId}</span>,
    },
    {
      key: "details",
      label: "Details",
      render: (log: any) => (
        <button
          onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
          className="text-primary-600 text-xs font-medium hover:underline"
        >
          {expandedId === log.id ? "Hide" : "View"}
        </button>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <History className="h-6 w-6 text-primary-600" /> Audit Log
          </h1>
          <p className="text-gray-500 mt-1">Trail of key actions taken across the system</p>
        </div>
        <select className="input-field w-auto" value={moduleFilter} onChange={(e) => { setModuleFilter(e.target.value); setPage(1); }}>
          <option value="">All modules</option>
          <option value="student">Student</option>
          <option value="payment">Payment</option>
          <option value="refund">Refund</option>
        </select>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchLogs} />}

      <div className="card">
        <DataTable columns={columns} data={logs} loading={loading} page={page} totalPages={totalPages} onPageChange={setPage} emptyMessage="No audit log entries yet" />
      </div>

      {expandedId && (
        <div className="card mt-4">
          <h3 className="text-sm font-semibold text-gray-600 mb-2">Details</h3>
          <pre className="text-xs bg-gray-50 p-3 rounded-lg overflow-x-auto max-h-96">
            {JSON.stringify(logs.find((l) => l.id === expandedId), null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
