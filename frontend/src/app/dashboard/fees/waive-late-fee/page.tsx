"use client";

import { useState } from "react";
import { MinusCircle, Search, CheckCircle2, AlertCircle } from "lucide-react";
import api from "@/lib/api";
import { formatCurrency } from "@/lib/utils";


export default function WaiveLateFeeFeePage() {
  const [studentId, setStudentId] = useState("");
  const [pendingFees, setPendingFees] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [waiving, setWaiving] = useState<string | null>(null);
  const [result, setResult] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const searchFees = async () => {
    if (!studentId.trim()) return;
    setSearching(true);
    setPendingFees([]);
    setResult(null);
    try {
      const res = await api.get(`/fees/pending/${studentId}`);
      const fees = (res.data.data || []).filter((f: any) => Number(f.lateFee) > 0);
      setPendingFees(fees);
      if (fees.length === 0) {
        setResult({ type: "error", text: "No fee assignments with late fees found for this student." });
      }
    } catch (err: any) {
      setResult({ type: "error", text: err.response?.data?.message || "Student not found" });
    } finally { setSearching(false); }
  };

  const handleWaive = async (feeAssignmentId: string) => {
    if (!confirm("Waive the late fee for this assignment? This cannot be undone.")) return;
    setWaiving(feeAssignmentId);
    try {
      await api.patch(`/fees/waive-late-fee/${feeAssignmentId}`);
      setResult({ type: "success", text: "Late fee waived successfully!" });
      // Refresh
      searchFees();
    } catch (err: any) {
      setResult({ type: "error", text: err.response?.data?.message || "Failed to waive late fee" });
    } finally { setWaiving(null); }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <MinusCircle className="h-6 w-6 text-primary-600" /> Waive Late Fee
        </h1>
        <p className="text-gray-500 mt-1">Remove late fee charges from student fee assignments</p>
      </div>

      {result && (
        <div className={`mb-4 p-3 rounded-lg text-sm border flex items-center gap-2 ${
          result.type === "success" ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"
        }`}>
          {result.type === "success" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {result.text}
        </div>
      )}

      <div className="card max-w-2xl mb-6">
        <label className="block text-sm font-medium mb-2">Search by Student ID</label>
        <div className="flex gap-2">
          <input className="input-field flex-1" value={studentId} onChange={(e) => setStudentId(e.target.value)} placeholder="Enter student ID (cuid)" />
          <button onClick={searchFees} disabled={searching} className="btn-primary flex items-center gap-1.5 disabled:opacity-50">
            <Search className="h-4 w-4" /> {searching ? "..." : "Search"}
          </button>
        </div>
      </div>

      {pendingFees.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="px-4 py-3 text-left">Fee Category</th>
                <th className="px-4 py-3 text-right">Total Amount</th>
                <th className="px-4 py-3 text-right">Paid</th>
                <th className="px-4 py-3 text-right text-red-600">Late Fee</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {pendingFees.map((f: any) => (
                <tr key={f.id} className="border-b">
                  <td className="px-4 py-3 font-medium">{f.feeStructure?.feeCategory?.name || "N/A"}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(Number(f.totalAmount))}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(Number(f.paidAmount))}</td>
                  <td className="px-4 py-3 text-right font-bold text-red-600">{formatCurrency(Number(f.lateFee))}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">{f.status}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => handleWaive(f.id)} disabled={waiving === f.id} className="btn-primary text-xs py-1.5 px-3 disabled:opacity-50">
                      {waiving === f.id ? "Waiving..." : "Waive Late Fee"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
