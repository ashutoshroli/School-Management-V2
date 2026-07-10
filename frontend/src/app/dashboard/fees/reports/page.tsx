"use client";

import { useState, useEffect } from "react";
import { BarChart3, AlertCircle } from "lucide-react";
import api from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

export default function FeeReportsPage() {
  const [tab, setTab] = useState<"summary" | "defaulters">("summary");
  const [summary, setSummary] = useState<any>(null);
  const [defaulters, setDefaulters] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (tab === "summary") {
        const res = await api.get("/fees/reports/class-summary");
        setSummary(res.data.data);
      } else {
        const res = await api.get("/fees/reports/defaulters");
        setDefaulters(res.data.data);
      }
    } catch (err) {} finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [tab]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-primary-600" /> Fee Reports
        </h1>
      </div>
      <div className="flex gap-2 mb-6">
        <button onClick={() => setTab("summary")}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "summary" ? "bg-primary-600 text-white" : "bg-gray-100 text-gray-700"}`}>
          Class-wise Summary
        </button>
        <button onClick={() => setTab("defaulters")}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "defaulters" ? "bg-red-600 text-white" : "bg-gray-100 text-gray-700"}`}>
          Defaulters
        </button>
      </div>


      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : tab === "summary" && summary ? (
        <div>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="card text-center"><p className="text-sm text-gray-500">Total Assigned</p><p className="text-xl font-bold">{formatCurrency(summary.grandTotal.totalAssigned)}</p></div>
            <div className="card text-center"><p className="text-sm text-gray-500">Total Collected</p><p className="text-xl font-bold text-green-700">{formatCurrency(summary.grandTotal.totalCollected)}</p></div>
            <div className="card text-center"><p className="text-sm text-gray-500">Total Pending</p><p className="text-xl font-bold text-red-600">{formatCurrency(summary.grandTotal.totalPending)}</p></div>
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-gray-50">
                <th className="px-4 py-3 text-left">Class</th><th className="px-4 py-3 text-left">Students</th>
                <th className="px-4 py-3 text-right">Assigned</th><th className="px-4 py-3 text-right">Collected</th>
                <th className="px-4 py-3 text-right">Pending</th><th className="px-4 py-3 text-right">%</th>
              </tr></thead>
              <tbody>
                {summary.summary.map((r: any) => (
                  <tr key={r.classId} className="border-b"><td className="px-4 py-3 font-medium">{r.className}</td><td className="px-4 py-3">{r.studentCount}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(r.totalAssigned)}</td><td className="px-4 py-3 text-right text-green-700">{formatCurrency(r.totalCollected)}</td>
                    <td className="px-4 py-3 text-right text-red-600">{formatCurrency(r.totalPending)}</td><td className="px-4 py-3 text-right font-medium">{r.collectionPercent}%</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : tab === "defaulters" && defaulters ? (
        <div>
          <div className="card mb-4 flex items-center gap-3"><AlertCircle className="h-5 w-5 text-red-500" /><span className="font-medium text-red-700">{defaulters.totalDefaulters} defaulters | Pending: {formatCurrency(defaulters.totalPending)}</span></div>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-gray-50"><th className="px-4 py-3 text-left">Student</th><th className="px-4 py-3 text-left">Class</th><th className="px-4 py-3 text-left">Fee</th><th className="px-4 py-3 text-right">Pending</th><th className="px-4 py-3">Status</th></tr></thead>
              <tbody>
                {defaulters.defaulters.map((d: any) => (
                  <tr key={d.id} className="border-b"><td className="px-4 py-3"><p className="font-medium">{d.student.user.name}</p><p className="text-xs text-gray-500">{d.student.user.phone}</p></td>
                    <td className="px-4 py-3">{d.student.class.name}-{d.student.section.name}</td><td className="px-4 py-3">{d.feeStructure.feeCategory.name}</td>
                    <td className="px-4 py-3 text-right font-semibold text-red-600">{formatCurrency(d.pendingAmount)}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs ${d.status === "OVERDUE" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700"}`}>{d.status}</span></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
