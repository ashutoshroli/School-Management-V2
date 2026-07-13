"use client";

import { useState } from "react";
import { RotateCcw, Search, CheckCircle2, AlertCircle } from "lucide-react";
import api from "@/lib/api";
import { formatCurrency } from "@/lib/utils";


export default function RefundsPage() {
  const [paymentId, setPaymentId] = useState("");
  const [payment, setPayment] = useState<any>(null);
  const [searching, setSearching] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const searchPayment = async () => {
    if (!paymentId.trim()) return;
    setSearching(true);
    setPayment(null);
    setResult(null);
    try {
      // Search by receipt number in student payments
      const res = await api.get(`/fees/payments/${paymentId}`);
      const data = res.data.data;
      if (data && data.length > 0) {
        setPayment(data[0]);
        setAmount(String(data[0].amount));
      } else {
        setResult({ type: "error", text: "No payment found with this ID/receipt number." });
      }
    } catch (err: any) {
      setResult({ type: "error", text: err.response?.data?.message || "Payment not found" });
    } finally { setSearching(false); }
  };

  const handleRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payment) return;
    if (!confirm(`Process refund of ${formatCurrency(Number(amount))} for payment ${payment.receiptNo}?`)) return;
    setProcessing(true);
    setResult(null);
    try {
      await api.post("/fees/refund", {
        paymentId: payment.id,
        amount: parseFloat(amount),
        reason,
      });
      setResult({ type: "success", text: `Refund of ${formatCurrency(Number(amount))} processed successfully!` });
      setPayment(null);
      setPaymentId("");
      setAmount("");
      setReason("");
    } catch (err: any) {
      setResult({ type: "error", text: err.response?.data?.message || "Failed to process refund" });
    } finally { setProcessing(false); }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <RotateCcw className="h-6 w-6 text-primary-600" /> Fee Refund
        </h1>
        <p className="text-gray-500 mt-1">Process refunds for fee payments</p>
      </div>

      {result && (
        <div className={`mb-4 p-3 rounded-lg text-sm border flex items-center gap-2 ${
          result.type === "success" ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"
        }`}>
          {result.type === "success" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {result.text}
        </div>
      )}

      <div className="card max-w-lg">
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium mb-1">Student ID / Payment Receipt No</label>
            <div className="flex gap-2">
              <input className="input-field flex-1" value={paymentId} onChange={(e) => setPaymentId(e.target.value)} placeholder="Enter student ID or receipt number" />
              <button onClick={searchPayment} disabled={searching} className="btn-primary flex items-center gap-1.5 disabled:opacity-50">
                <Search className="h-4 w-4" /> {searching ? "..." : "Find"}
              </button>
            </div>
          </div>

          {payment && (
            <form onSubmit={handleRefund} className="space-y-4 border-t pt-4">
              <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                <p><strong>Receipt:</strong> {payment.receiptNo}</p>
                <p><strong>Student:</strong> {payment.student?.user?.name || "N/A"}</p>
                <p><strong>Amount Paid:</strong> {formatCurrency(Number(payment.amount))}</p>
                <p><strong>Mode:</strong> {payment.paymentMode}</p>
                <p><strong>Status:</strong> {payment.status}</p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Refund Amount *</label>
                <input type="number" step="0.01" min="0.01" max={payment.amount} className="input-field" value={amount} onChange={(e) => setAmount(e.target.value)} required />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Reason *</label>
                <textarea className="input-field" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for refund" required />
              </div>

              <button type="submit" disabled={processing} className="btn-primary w-full disabled:opacity-50">
                {processing ? "Processing..." : "Process Refund"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
