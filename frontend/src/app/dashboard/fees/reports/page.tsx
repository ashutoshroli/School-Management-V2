"use client";

import { useState, useEffect } from "react";
import { BarChart3, AlertCircle, Send, TrendingUp, Download, PieChart } from "lucide-react";
import api from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";

const PAYMENT_MODE_COLORS: Record<string, string> = {
  CASH: "bg-green-500",
  CHEQUE: "bg-blue-500",
  DD: "bg-indigo-500",
  ONLINE_RAZORPAY: "bg-purple-500",
  ONLINE_PAYU: "bg-fuchsia-500",
  UPI: "bg-orange-500",
  BANK_TRANSFER: "bg-teal-500",
};

export default function FeeReportsPage() {
  const [tab, setTab] = useState<"summary" | "defaulters" | "trend" | "payment-mode">("summary");
  const [summary, setSummary] = useState<any>(null);
  const [defaulters, setDefaulters] = useState<any>(null);
  const [trend, setTrend] = useState<any>(null);
  const [trendDays, setTrendDays] = useState(30);
  const [paymentModeBreakdown, setPaymentModeBreakdown] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendingReminders, setSendingReminders] = useState(false);
  const [reminderResult, setReminderResult] = useState<string | null>(null);

  const downloadDefaultersCsv = async () => {
    const res = await api.get("/fees/reports/defaulters/export", { responseType: "blob" });
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const link = document.createElement("a");
    link.href = url;
    link.download = `fee-defaulters-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  const sendReminders = async () => {
    setSendingReminders(true);
    setReminderResult(null);
    try {
      const res = await api.post("/fees/reminders/send");
      const { notified, totalDefaulters } = res.data.data;
      setReminderResult(`Reminders sent to ${notified} parent(s) across ${totalDefaulters} student(s).`);
    } catch (err: any) {
      setReminderResult(err?.response?.data?.message || "Failed to send reminders");
    } finally {
      setSendingReminders(false);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      if (tab === "summary") {
        const res = await api.get("/fees/reports/class-summary");
        setSummary(res.data.data);
      } else if (tab === "trend") {
        const res = await api.get("/fees/reports/collection-trend", { params: { days: trendDays } });
        setTrend(res.data.data);
      } else if (tab === "payment-mode") {
        const res = await api.get("/fees/reports/payment-mode-breakdown");
        setPaymentModeBreakdown(res.data.data || []);
      } else {
        const res = await api.get("/fees/reports/defaulters");
        setDefaulters(res.data.data);
      }
    } catch (err) {} finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [tab, trendDays]);

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
        <button onClick={() => setTab("trend")}
          className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 ${tab === "trend" ? "bg-primary-600 text-white" : "bg-gray-100 text-gray-700"}`}>
          <TrendingUp className="h-4 w-4" /> Collection Trend
        </button>
        <button onClick={() => setTab("payment-mode")}
          className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 ${tab === "payment-mode" ? "bg-primary-600 text-white" : "bg-gray-100 text-gray-700"}`}>
          <PieChart className="h-4 w-4" /> Payment Mode
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
          <div className="card mb-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-red-500" />
              <span className="font-medium text-red-700">{defaulters.totalDefaulters} defaulters | Pending: {formatCurrency(defaulters.totalPending)}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={downloadDefaultersCsv}
                disabled={defaulters.totalDefaulters === 0}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
              >
                <Download className="h-4 w-4" /> Export CSV
              </button>
              <button
                onClick={sendReminders}
                disabled={sendingReminders || defaulters.totalDefaulters === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-primary-600 text-white disabled:opacity-50"
              >
                <Send className="h-4 w-4" /> {sendingReminders ? "Sending..." : "Send Reminders (Email + SMS)"}
              </button>
            </div>
          </div>
          {reminderResult && (
            <div className="mb-4 text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2">{reminderResult}</div>
          )}
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
      ) : tab === "trend" && trend ? (
        <div>
          <div className="card mb-4 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm text-gray-500">Total Collected (last {trend.days} days)</p>
              <p className="text-xl font-bold text-green-700">{formatCurrency(trend.totalCollected)}</p>
            </div>
            <select className="input-field w-auto" value={trendDays} onChange={(e) => setTrendDays(Number(e.target.value))}>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </div>
          <div className="card">
            <h3 className="font-semibold mb-4">Daily Collection</h3>
            {/* Plain CSS bar chart - deliberately avoids adding a
                charting library dependency for a single simple trend
                view; each bar's height is scaled relative to the
                max day's collection in the current range. */}
            <div className="flex items-end gap-1 h-48 overflow-x-auto pb-2">
              {(() => {
                const max = Math.max(...trend.trend.map((t: any) => t.amount), 1);
                return trend.trend.map((t: any) => (
                  <div key={t.date} className="flex flex-col items-center justify-end h-full min-w-[8px] flex-1 group relative">
                    <div className="hidden group-hover:block absolute -top-8 bg-gray-900 text-white text-[10px] rounded px-2 py-1 whitespace-nowrap z-10">
                      {formatDate(t.date)}: {formatCurrency(t.amount)}
                    </div>
                    <div
                      className={`w-full rounded-t ${t.amount > 0 ? "bg-primary-500" : "bg-gray-100"}`}
                      style={{ height: `${Math.max((t.amount / max) * 100, 2)}%` }}
                    />
                  </div>
                ));
              })()}
            </div>
            <p className="text-xs text-gray-400 mt-2 text-center">Hover over a bar to see the exact date and amount</p>
          </div>
        </div>
      ) : tab === "payment-mode" ? (
        <div>
          {paymentModeBreakdown.length === 0 ? (
            <p className="text-center text-gray-400 py-12">No successful payments recorded yet</p>
          ) : (
            (() => {
              const grandTotal = paymentModeBreakdown.reduce((sum, b) => sum + b.totalAmount, 0);
              return (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="card">
                    <h3 className="font-semibold mb-4">Collection by Payment Mode</h3>
                    {/* Plain CSS stacked bar - same "no charting library
                        dependency" convention as the trend tab's bar chart above. */}
                    <div className="flex h-4 rounded-full overflow-hidden mb-4">
                      {paymentModeBreakdown.map((b) => (
                        <div
                          key={b.paymentMode}
                          className={PAYMENT_MODE_COLORS[b.paymentMode] || "bg-gray-400"}
                          style={{ width: `${grandTotal > 0 ? (b.totalAmount / grandTotal) * 100 : 0}%` }}
                          title={`${b.paymentMode}: ${formatCurrency(b.totalAmount)}`}
                        />
                      ))}
                    </div>
                    <div className="space-y-2">
                      {paymentModeBreakdown
                        .sort((a, b) => b.totalAmount - a.totalAmount)
                        .map((b) => (
                          <div key={b.paymentMode} className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-2">
                              <span className={`w-2.5 h-2.5 rounded-full ${PAYMENT_MODE_COLORS[b.paymentMode] || "bg-gray-400"}`} />
                              {b.paymentMode.replace(/_/g, " ")}
                            </span>
                            <span className="text-gray-500">{b.transactionCount} txn(s)</span>
                            <span className="font-medium">{formatCurrency(b.totalAmount)}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                  <div className="card overflow-x-auto">
                    <h3 className="font-semibold mb-4">Details</h3>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-gray-50">
                          <th className="px-3 py-2 text-left">Mode</th>
                          <th className="px-3 py-2 text-right">Transactions</th>
                          <th className="px-3 py-2 text-right">Amount</th>
                          <th className="px-3 py-2 text-right">%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paymentModeBreakdown
                          .sort((a, b) => b.totalAmount - a.totalAmount)
                          .map((b) => (
                            <tr key={b.paymentMode} className="border-b">
                              <td className="px-3 py-2">{b.paymentMode.replace(/_/g, " ")}</td>
                              <td className="px-3 py-2 text-right">{b.transactionCount}</td>
                              <td className="px-3 py-2 text-right font-medium">{formatCurrency(b.totalAmount)}</td>
                              <td className="px-3 py-2 text-right text-gray-500">
                                {grandTotal > 0 ? Math.round((b.totalAmount / grandTotal) * 100) : 0}%
                              </td>
                            </tr>
                          ))}
                        <tr className="font-semibold bg-gray-50">
                          <td className="px-3 py-2">Total</td>
                          <td className="px-3 py-2 text-right">{paymentModeBreakdown.reduce((s, b) => s + b.transactionCount, 0)}</td>
                          <td className="px-3 py-2 text-right">{formatCurrency(grandTotal)}</td>
                          <td className="px-3 py-2 text-right">100%</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()
          )}
        </div>
      ) : null}
    </div>
  );
}
