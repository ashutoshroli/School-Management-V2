"use client";

import { useState, useEffect } from "react";
import { Wallet, Play, Check, IndianRupee, Download } from "lucide-react";
import api from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { openPdfInNewTab } from "@/lib/pdf";

export default function PayrollPage() {
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  const fetchPayslips = async () => {
    setLoading(true);
    try {
      const res = await api.get("/hr/payroll/payslips", { params: { month, year } });
      setData(res.data.data);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { fetchPayslips(); }, [month, year]);

  const runPayroll = async () => {
    if (!confirm(`Run payroll for ${month}/${year}? This will generate payslips for all staff with salary structure.`)) return;
    setRunning(true);
    try {
      const res = await api.post("/hr/payroll/run", { month, year });
      alert(res.data.message);
      fetchPayslips();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
    finally { setRunning(false); }
  };

  const approveAll = async () => {
    if (!data?.payslips?.length) return;
    const drafts = data.payslips.filter((p: any) => p.status === "DRAFT");
    for (const p of drafts) {
      await api.patch(`/hr/payroll/payslip/${p.id}/approve`);
    }
    alert(`${drafts.length} payslips approved`);
    fetchPayslips();
  };

  const markPaid = async (id: string) => {
    try {
      await api.patch(`/hr/payroll/payslip/${id}/paid`);
      fetchPayslips();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to mark as paid");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Wallet className="h-6 w-6 text-primary-600" /> Payroll
          </h1>
          <p className="text-gray-500 mt-1">Monthly salary processing</p>
        </div>
        <div className="flex items-center gap-3">
          <select className="input-field w-auto" value={month} onChange={e => setMonth(parseInt(e.target.value))}>
            {Array.from({length: 12}, (_, i) => <option key={i+1} value={i+1}>{new Date(0, i).toLocaleString("en", {month: "long"})}</option>)}
          </select>
          <input type="number" className="input-field w-24" value={year} onChange={e => setYear(parseInt(e.target.value))} />
          <button onClick={runPayroll} disabled={running} className="btn-primary flex items-center gap-2">
            <Play className="h-4 w-4" /> {running ? "Running..." : "Run Payroll"}
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {data?.summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <div className="card text-center"><p className="text-xs text-gray-500">Staff</p><p className="text-xl font-bold">{data.summary.count}</p></div>
          <div className="card text-center"><p className="text-xs text-gray-500">Net Pay</p><p className="text-xl font-bold text-green-700">{formatCurrency(data.summary.totalNetPay)}</p></div>
          <div className="card text-center"><p className="text-xs text-gray-500">PF</p><p className="text-xl font-bold text-blue-700">{formatCurrency(data.summary.totalPf)}</p></div>
          <div className="card text-center"><p className="text-xs text-gray-500">ESI</p><p className="text-xl font-bold text-purple-700">{formatCurrency(data.summary.totalEsi)}</p></div>
          <div className="card text-center"><p className="text-xs text-gray-500">TDS</p><p className="text-xl font-bold text-red-600">{formatCurrency(data.summary.totalTds)}</p></div>
        </div>
      )}

      {data?.payslips?.length > 0 && data.payslips.some((p: any) => p.status === "DRAFT") && (
        <div className="mb-4">
          <button onClick={approveAll} className="btn-primary flex items-center gap-2 text-sm">
            <Check className="h-4 w-4" /> Approve All Drafts
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : !data?.payslips?.length ? (
        <div className="card text-center py-12 text-gray-500">
          <Wallet className="h-12 w-12 mx-auto text-gray-300 mb-3" />
          <p>No payslips for this month. Click "Run Payroll" to generate.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-gray-50">
              <th className="px-4 py-3 text-left">Staff</th>
              <th className="px-4 py-3 text-right">Working</th>
              <th className="px-4 py-3 text-right">Present</th>
              <th className="px-4 py-3 text-right">Gross</th>
              <th className="px-4 py-3 text-right">PF</th>
              <th className="px-4 py-3 text-right">ESI</th>
              <th className="px-4 py-3 text-right">TDS</th>
              <th className="px-4 py-3 text-right">Net Pay</th>
              <th className="px-4 py-3 text-center">Status</th>
              <th className="px-4 py-3 text-center">Payslip</th>
            </tr></thead>
            <tbody>
              {data.payslips.map((p: any) => (
                <tr key={p.id} className="border-b">
                  <td className="px-4 py-3 font-medium">{p.staff?.user?.name}</td>
                  <td className="px-4 py-3 text-right">{p.workingDays}</td>
                  <td className="px-4 py-3 text-right">{p.presentDays}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(p.grossEarning)}</td>
                  <td className="px-4 py-3 text-right text-blue-600">{formatCurrency(p.pfAmount)}</td>
                  <td className="px-4 py-3 text-right text-purple-600">{formatCurrency(p.esiAmount)}</td>
                  <td className="px-4 py-3 text-right text-red-600">{formatCurrency(p.tdsAmount)}</td>
                  <td className="px-4 py-3 text-right font-bold text-green-700">{formatCurrency(p.netPay)}</td>
                  <td className="px-4 py-3 text-center">
                    {p.status === "APPROVED" ? (
                      <button
                        onClick={() => markPaid(p.id)}
                        className="px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700 hover:bg-blue-200"
                        title="Mark as paid"
                      >
                        {p.status} - Mark Paid
                      </button>
                    ) : (
                      <span className={`px-2 py-0.5 rounded-full text-xs ${
                        p.status === "PAID" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
                      }`}>{p.status}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      type="button"
                      onClick={() => openPdfInNewTab(`/hr/payroll/payslip/${p.staffId}/${p.month}/${p.year}/pdf`)}
                      className="text-primary-600 hover:text-primary-700"
                      title="Download payslip PDF"
                    >
                      <Download className="h-4 w-4 inline" />
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
