"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Wallet, Search, Loader2, AlertTriangle, CreditCard, CheckCircle2 } from "lucide-react";
import api from "@/lib/api";
import { payPublicFeeWithRazorpay } from "@/lib/razorpay";

/**
 * Public, unauthenticated fee-status lookup + "Pay Now" page - same
 * admissionNo + dateOfBirth identity check as the public results page,
 * then hands off to the existing Razorpay checkout flow (see
 * lib/razorpay.ts's payPublicFeeWithRazorpay) scoped to one fee
 * assignment at a time.
 */
export default function PublicPayFeesPage() {
  const [admissionNo, setAdmissionNo] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payMessage, setPayMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    setPayMessage(null);
    setLoading(true);
    try {
      const res = await api.post("/public/fees/lookup", { admissionNo, dateOfBirth });
      const data = res.data.data;
      if (!data.found) {
        setError("No matching student record found. Please check your Admission Number and Date of Birth.");
      } else {
        setResult(data);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handlePayNow = async (feeAssignmentId: string) => {
    setPayingId(feeAssignmentId);
    setPayMessage(null);
    try {
      await payPublicFeeWithRazorpay({
        admissionNo,
        dateOfBirth,
        feeAssignmentId,
        studentName: result.studentName,
      });
      setPayMessage({ type: "success", text: "Payment successful! A receipt has been sent to your registered contact." });
      // Refresh the dues list so the paid item drops off.
      const res = await api.post("/public/fees/lookup", { admissionNo, dateOfBirth });
      setResult(res.data.data);
    } catch (err: any) {
      setPayMessage({ type: "error", text: err.message || err.response?.data?.message || "Payment failed or was cancelled." });
    } finally {
      setPayingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="max-w-2xl mx-auto">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6">
          <ArrowLeft className="h-4 w-4" /> Back to Home
        </Link>

        <div className="flex items-center gap-2 mb-6">
          <Wallet className="h-7 w-7 text-primary-600" />
          <h1 className="text-xl font-bold text-gray-900">Check &amp; Pay Fees</h1>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Admission Number *</label>
            <input className="input-field" value={admissionNo} onChange={(e) => setAdmissionNo(e.target.value)} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date of Birth *</label>
            <input type="date" className="input-field" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} required />
          </div>
          <button type="submit" disabled={loading} className="btn-primary w-full py-2.5 flex items-center justify-center gap-2 disabled:opacity-60">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {loading ? "Searching..." : "Check Dues"}
          </button>
        </form>

        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-6">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" /> {error}
          </div>
        )}

        {payMessage && (
          <div className={`flex items-start gap-2 text-sm rounded-lg px-4 py-3 mb-6 ${payMessage.type === "success" ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-700"}`}>
            {payMessage.type === "success" ? <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" /> : <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />}
            {payMessage.text}
          </div>
        )}

        {result && (
          <div className="card space-y-4">
            <div className="border-b pb-3">
              <h2 className="font-semibold text-gray-900">{result.studentName}</h2>
              <p className="text-sm text-gray-500">
                {result.admissionNo} - {result.className} {result.sectionName} - {result.branchName}
              </p>
            </div>

            {result.dues.length === 0 ? (
              <div className="flex items-center gap-2 text-green-700 text-sm">
                <CheckCircle2 className="h-5 w-5" /> No outstanding dues. All fees are paid up!
              </div>
            ) : (
              <>
                <div className="flex justify-between items-center bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                  <span className="text-sm font-medium text-amber-800">Total Outstanding</span>
                  <span className="text-lg font-bold text-amber-900">Rs {Number(result.totalPending).toLocaleString("en-IN")}</span>
                </div>
                <div className="space-y-2">
                  {result.dues.map((d: any) => (
                    <div key={d.feeAssignmentId} className="flex items-center justify-between border rounded-lg px-4 py-3">
                      <div>
                        <p className="font-medium text-sm">{d.category}</p>
                        <p className="text-xs text-gray-500">Pending: Rs {Number(d.pendingAmount).toLocaleString("en-IN")} - {d.status}</p>
                      </div>
                      <button
                        onClick={() => handlePayNow(d.feeAssignmentId)}
                        disabled={payingId === d.feeAssignmentId}
                        className="btn-primary text-sm flex items-center gap-2 disabled:opacity-60"
                      >
                        {payingId === d.feeAssignmentId ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                        Pay Now
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
