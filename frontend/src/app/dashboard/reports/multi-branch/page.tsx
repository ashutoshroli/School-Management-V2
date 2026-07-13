"use client";

import { useState, useEffect } from "react";
import { Building2, Users, GraduationCap, IndianRupee } from "lucide-react";
import api from "@/lib/api";
import { formatCurrency } from "@/lib/utils";


interface BranchSummary {
  branchId: string;
  branchName: string;
  students: number;
  staff: number;
  totalFees: number;
  collected: number;
  pending: number;
  attendanceRate: number;
}

export default function MultiBranchPage() {
  const [data, setData] = useState<BranchSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const res = await api.get("/reports/multi-branch");
        setData(res.data.data || []);
      } catch { setData([]); }
      finally { setLoading(false); }
    };
    fetchData();
  }, []);

  const totals = data.reduce((acc, b) => ({
    students: acc.students + b.students,
    staff: acc.staff + b.staff,
    totalFees: acc.totalFees + b.totalFees,
    collected: acc.collected + b.collected,
    pending: acc.pending + b.pending,
  }), { students: 0, staff: 0, totalFees: 0, collected: 0, pending: 0 });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Building2 className="h-6 w-6 text-primary-600" /> Multi-Branch Summary
        </h1>
        <p className="text-gray-500 mt-1">Overview of all branches (Super Admin only)</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
        </div>
      ) : data.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-500">No branch data available.</p>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="card text-center">
              <Building2 className="h-6 w-6 text-primary-600 mx-auto mb-2" />
              <p className="text-2xl font-bold">{data.length}</p>
              <p className="text-xs text-gray-500">Branches</p>
            </div>
            <div className="card text-center">
              <GraduationCap className="h-6 w-6 text-blue-600 mx-auto mb-2" />
              <p className="text-2xl font-bold">{totals.students}</p>
              <p className="text-xs text-gray-500">Total Students</p>
            </div>
            <div className="card text-center">
              <Users className="h-6 w-6 text-green-600 mx-auto mb-2" />
              <p className="text-2xl font-bold">{totals.staff}</p>
              <p className="text-xs text-gray-500">Total Staff</p>
            </div>
            <div className="card text-center">
              <IndianRupee className="h-6 w-6 text-amber-600 mx-auto mb-2" />
              <p className="text-2xl font-bold">{formatCurrency(totals.collected)}</p>
              <p className="text-xs text-gray-500">Total Collected</p>
            </div>
          </div>

          {/* Branch Table */}
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="px-4 py-3 text-left">Branch</th>
                  <th className="px-4 py-3 text-center">Students</th>
                  <th className="px-4 py-3 text-center">Staff</th>
                  <th className="px-4 py-3 text-right">Total Fees</th>
                  <th className="px-4 py-3 text-right">Collected</th>
                  <th className="px-4 py-3 text-right">Pending</th>
                  <th className="px-4 py-3 text-center">Attendance %</th>
                </tr>
              </thead>
              <tbody>
                {data.map((b) => (
                  <tr key={b.branchId} className="border-b">
                    <td className="px-4 py-3 font-medium">{b.branchName}</td>
                    <td className="px-4 py-3 text-center">{b.students}</td>
                    <td className="px-4 py-3 text-center">{b.staff}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(b.totalFees)}</td>
                    <td className="px-4 py-3 text-right text-green-700">{formatCurrency(b.collected)}</td>
                    <td className="px-4 py-3 text-right text-red-600">{formatCurrency(b.pending)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`font-medium ${b.attendanceRate >= 80 ? "text-green-700" : b.attendanceRate >= 60 ? "text-yellow-700" : "text-red-600"}`}>
                        {b.attendanceRate?.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
