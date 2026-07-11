"use client";

import { useEffect, useState } from "react";
import { IndianRupee, Download, CreditCard } from "lucide-react";
import api from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";
import { payFeeWithRazorpay } from "@/lib/razorpay";
import { openPdfInNewTab } from "@/lib/pdf";
import { useChildren } from "@/hooks/useChildren";
import { useAuth } from "@/hooks/useAuth";
import ChildSwitcher from "@/components/parent/ChildSwitcher";
import ErrorBanner from "@/components/ui/ErrorBanner";

export default function MyFeesPage() {
  const { user } = useAuth();
  const { children, selectedChildId, fetchChildren } = useChildren();
  const [pendingFees, setPendingFees] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);

  const selectedChild = children.find((c) => c.id === selectedChildId);

  useEffect(() => {
    fetchChildren();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadFees = async () => {
    if (!selectedChildId) return;
    setLoading(true);
    setError(null);
    try {
      const [pendingRes, paymentsRes] = await Promise.all([
        api.get(`/fees/pending/${selectedChildId}`),
        api.get(`/fees/payments/${selectedChildId}`),
      ]);
      setPendingFees(pendingRes.data.data || []);
      setPayments(paymentsRes.data.data || []);
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to load fee details");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedChildId) loadFees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChildId]);

  const handlePayOnline = async (fee: any) => {
    if (!selectedChild) return;
    setPayingId(fee.id);
    try {
      const branchStudent = await api.get(`/students/${selectedChildId}`);
      const branchId = branchStudent.data.data.branchId;

      const result = await payFeeWithRazorpay({
        branchId,
        studentId: selectedChildId!,
        feeAssignmentId: fee.id,
        studentName: selectedChild.user.name,
        studentEmail: selectedChild.user.email,
      });
      alert(`Payment successful! Receipt: ${result.payment.receiptNo}`);
      await loadFees();
    } catch (err: any) {
      alert(err.response?.data?.message || err.message || "Payment failed");
    } finally {
      setPayingId(null);
    }
  };

  const totalPending = pendingFees.reduce((sum, f) => sum + f.pendingAmount, 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <IndianRupee className="h-6 w-6 text-primary-600" /> My Fees
          </h1>
          <p className="text-gray-500 mt-1">
            {user?.role === "PARENT" ? "View and pay your child's fees online" : "View and pay your fees online"}
          </p>
        </div>
        <ChildSwitcher />
      </div>

      {error && <ErrorBanner message={error} onRetry={loadFees} />}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
        </div>
      ) : selectedChildId ? (
        <div className="space-y-6">
          <div className="card bg-gradient-to-r from-primary-600 to-primary-700 text-white">
            <p className="text-sm opacity-80">Total Pending Amount</p>
            <p className="text-3xl font-bold mt-1">{formatCurrency(totalPending)}</p>
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold mb-4">Pending Fees</h3>
            {pendingFees.length === 0 ? (
              <p className="text-green-600 font-medium">No pending fees! All paid up.</p>
            ) : (
              <div className="space-y-3">
                {pendingFees.map((fee) => (
                  <div key={fee.id} className="border rounded-lg p-4 flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <p className="font-medium">{fee.feeStructure.feeCategory.name}</p>
                      <p className="text-xs text-gray-500">
                        {fee.feeStructure.class?.name || `Transport: ${fee.feeStructure.transportRoute?.name}`} | {fee.feeStructure.frequency}
                      </p>
                      {fee.calculatedLateFee > 0 && (
                        <p className="text-xs text-orange-600 mt-1">Includes late fee: {formatCurrency(fee.calculatedLateFee)}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <p className="font-bold text-red-600 text-lg">{formatCurrency(fee.pendingAmount)}</p>
                      <button
                        onClick={() => handlePayOnline(fee)}
                        disabled={payingId === fee.id}
                        className="btn-primary flex items-center gap-2 text-sm disabled:opacity-60"
                      >
                        <CreditCard className="h-4 w-4" />
                        {payingId === fee.id ? "Processing..." : "Pay Now"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold mb-4">Payment History</h3>
            {payments.length === 0 ? (
              <p className="text-gray-400 text-sm">No payments recorded yet</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="px-4 py-3 text-left">Receipt No</th>
                      <th className="px-4 py-3 text-left">Category</th>
                      <th className="px-4 py-3 text-left">Date</th>
                      <th className="px-4 py-3 text-left">Amount</th>
                      <th className="px-4 py-3 text-left">Mode</th>
                      <th className="px-4 py-3 text-center">Receipt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id} className="border-b hover:bg-gray-50">
                        <td className="px-4 py-3 font-mono text-xs">{p.receiptNo}</td>
                        <td className="px-4 py-3">{p.feeAssignment?.feeStructure?.feeCategory?.name || "-"}</td>
                        <td className="px-4 py-3">{formatDate(p.paidAt)}</td>
                        <td className="px-4 py-3 font-medium">{formatCurrency(Number(p.amount))}</td>
                        <td className="px-4 py-3">{p.paymentMode.replace(/_/g, " ")}</td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => openPdfInNewTab(`/fees/payments/${p.id}/receipt`)}
                            className="inline-flex items-center gap-1 text-primary-600 text-xs font-medium hover:underline"
                          >
                            <Download className="h-3.5 w-3.5" /> Download
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
