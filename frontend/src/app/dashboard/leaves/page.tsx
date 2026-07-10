"use client";

import { useState, useEffect } from "react";
import { Calendar, Check, X, Clock } from "lucide-react";
import api from "@/lib/api";
import { formatDate } from "@/lib/utils";

export default function LeavesPage() {
  const [tab, setTab] = useState<"pending" | "all" | "balance">("pending");
  const [applications, setApplications] = useState<any[]>([]);
  const [balances, setBalances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (tab === "balance") {
        // For admin, show all staff—for staff, show own
        const res = await api.get("/hr/leave/balance/self");
        setBalances(res.data.data || []);
      } else {
        const params: any = {};
        if (tab === "pending") params.status = "PENDING";
        const res = await api.get("/hr/leave/applications", { params });
        setApplications(res.data.data || []);
      }
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [tab]);

  const handleAction = async (id: string, status: "APPROVED" | "REJECTED") => {
    try {
      await api.patch(`/hr/leave/${id}/status`, { status });
      fetchData();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Calendar className="h-6 w-6 text-primary-600" /> Leave Management
        </h1>
      </div>

      <div className="flex gap-2 mb-6">
        {[
          { key: "pending", label: "Pending Approvals" },
          { key: "all", label: "All Applications" },
          { key: "balance", label: "Leave Balance" },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key as any)}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === t.key ? "bg-primary-600 text-white" : "bg-gray-100 text-gray-700"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : tab === "balance" ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {balances.map(b => (
            <div key={b.code} className="card text-center">
              <p className="text-xs text-gray-500 mb-1">{b.leaveType}</p>
              <p className="text-2xl font-bold text-primary-700">{b.remaining}</p>
              <p className="text-xs text-gray-400">of {b.maxDays} | Used: {b.used}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-gray-50">
              <th className="px-4 py-3 text-left">Staff</th>
              <th className="px-4 py-3 text-left">Type</th>
              <th className="px-4 py-3 text-left">From</th>
              <th className="px-4 py-3 text-left">To</th>
              <th className="px-4 py-3 text-center">Days</th>
              <th className="px-4 py-3 text-left">Reason</th>
              <th className="px-4 py-3 text-center">Status</th>
              {tab === "pending" && <th className="px-4 py-3 text-center">Actions</th>}
            </tr></thead>
            <tbody>
              {applications.map(a => (
                <tr key={a.id} className="border-b">
                  <td className="px-4 py-3 font-medium">{a.staff?.user?.name}</td>
                  <td className="px-4 py-3">{a.leaveType?.name}</td>
                  <td className="px-4 py-3">{formatDate(a.fromDate)}</td>
                  <td className="px-4 py-3">{formatDate(a.toDate)}</td>
                  <td className="px-4 py-3 text-center font-bold">{a.days}</td>
                  <td className="px-4 py-3 text-gray-600 max-w-[200px] truncate">{a.reason}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      a.status === "APPROVED" ? "bg-green-100 text-green-700" :
                      a.status === "REJECTED" ? "bg-red-100 text-red-700" :
                      "bg-yellow-100 text-yellow-700"
                    }`}>{a.status}</span>
                  </td>
                  {tab === "pending" && (
                    <td className="px-4 py-3 text-center">
                      <div className="flex justify-center gap-2">
                        <button onClick={() => handleAction(a.id, "APPROVED")}
                          className="p-1.5 rounded-full bg-green-100 hover:bg-green-200 text-green-700" title="Approve">
                          <Check className="h-4 w-4" />
                        </button>
                        <button onClick={() => handleAction(a.id, "REJECTED")}
                          className="p-1.5 rounded-full bg-red-100 hover:bg-red-200 text-red-700" title="Reject">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {applications.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">No applications</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
