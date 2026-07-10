"use client";

import { useState } from "react";
import { IndianRupee, Search, Receipt } from "lucide-react";
import api from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

export default function FeeCollectionPage() {
  const [studentSearch, setStudentSearch] = useState("");
  const [students, setStudents] = useState<any[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [pendingFees, setPendingFees] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [payForm, setPayForm] = useState({
    feeAssignmentId: "", amount: "", paymentMode: "CASH",
    transactionId: "", chequeNo: "", bankName: "", remarks: "", waiveLateFee: false,
  });

  const searchStudents = async () => {
    if (!studentSearch.trim()) return;
    try {
      const res = await api.get("/students", { params: { search: studentSearch, limit: 10 } });
      setStudents(res.data.data || []);
    } catch (err) {}
  };

  const selectStudent = async (student: any) => {
    setSelectedStudent(student);
    setStudents([]);
    setStudentSearch("");
    setLoading(true);
    try {
      const res = await api.get(`/fees/pending/${student.id}`);
      setPendingFees(res.data.data || []);
    } catch (err) { setPendingFees([]); }
    finally { setLoading(false); }
  };

  const handleCollect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payForm.feeAssignmentId || !payForm.amount) { alert("Select fee and enter amount"); return; }
    setCollecting(true);
    try {
      const res = await api.post("/fees/collect", {
        ...payForm,
        amount: parseFloat(payForm.amount),
        studentId: selectedStudent.id,
        branchId: selectedStudent.branchId,
      });
      alert(`Payment collected! Receipt: ${res.data.data.payment.receiptNo}`);
      // Refresh pending
      const pRes = await api.get(`/fees/pending/${selectedStudent.id}`);
      setPendingFees(pRes.data.data || []);
      setPayForm({ feeAssignmentId: "", amount: "", paymentMode: "CASH", transactionId: "", chequeNo: "", bankName: "", remarks: "", waiveLateFee: false });
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
    finally { setCollecting(false); }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <IndianRupee className="h-6 w-6 text-primary-600" /> Fee Collection
        </h1>
        <p className="text-gray-500 mt-1">Search student and collect fees</p>
      </div>

      {/* Student Search */}
      <div className="card mb-6">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input className="input-field pl-10" placeholder="Search student by name, admission no..." value={studentSearch}
              onChange={(e) => setStudentSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && searchStudents()} />
          </div>
          <button onClick={searchStudents} className="btn-primary">Search</button>
        </div>
        {students.length > 0 && (
          <div className="mt-3 border rounded-lg max-h-48 overflow-y-auto">
            {students.map((s) => (
              <button key={s.id} onClick={() => selectStudent(s)}
                className="w-full text-left px-4 py-2 hover:bg-gray-50 border-b last:border-b-0 flex justify-between">
                <span className="font-medium">{s.user.name}</span>
                <span className="text-xs text-gray-500">{s.admissionNo} | {s.class?.name}-{s.section?.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedStudent && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Pending Fees */}
          <div className="lg:col-span-2">
            <div className="card">
              <h3 className="text-lg font-semibold mb-4">Pending Fees - {selectedStudent.user.name}</h3>
              {loading ? <div className="animate-pulse text-gray-400">Loading...</div> : pendingFees.length === 0 ? (
                <p className="text-green-600 font-medium">No pending fees! All paid.</p>
              ) : (
                <div className="space-y-3">
                  {pendingFees.map((fee) => (
                    <div key={fee.id} className={`border rounded-lg p-3 cursor-pointer transition-all ${payForm.feeAssignmentId === fee.id ? "border-primary-500 bg-primary-50" : "hover:border-gray-300"}`}
                      onClick={() => setPayForm({ ...payForm, feeAssignmentId: fee.id, amount: String(fee.pendingAmount) })}>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{fee.feeStructure.feeCategory.name}</p>
                          <p className="text-xs text-gray-500">{fee.feeStructure.class.name} | {fee.feeStructure.frequency}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-red-600">{formatCurrency(fee.pendingAmount)}</p>
                          {fee.calculatedLateFee > 0 && (
                            <p className="text-xs text-orange-600">Incl. late fee: {formatCurrency(fee.calculatedLateFee)}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Payment Form */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Receipt className="h-5 w-5 text-green-600" /> Collect Payment
            </h3>
            <form onSubmit={handleCollect} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount (Rs) *</label>
                <input type="number" className="input-field" value={payForm.amount}
                  onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payment Mode *</label>
                <select className="input-field" value={payForm.paymentMode}
                  onChange={(e) => setPayForm({ ...payForm, paymentMode: e.target.value })}>
                  <option value="CASH">Cash</option>
                  <option value="UPI">UPI</option>
                  <option value="CHEQUE">Cheque</option>
                  <option value="DD">DD</option>
                  <option value="BANK_TRANSFER">Bank Transfer</option>
                  <option value="ONLINE_RAZORPAY">Online (Razorpay)</option>
                </select>
              </div>
              {(payForm.paymentMode === "CHEQUE" || payForm.paymentMode === "DD") && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Cheque/DD No</label>
                  <input className="input-field" value={payForm.chequeNo} onChange={(e) => setPayForm({ ...payForm, chequeNo: e.target.value })} />
                </div>
              )}
              {payForm.paymentMode !== "CASH" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Transaction ID</label>
                  <input className="input-field" value={payForm.transactionId} onChange={(e) => setPayForm({ ...payForm, transactionId: e.target.value })} />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Remarks</label>
                <input className="input-field" value={payForm.remarks} onChange={(e) => setPayForm({ ...payForm, remarks: e.target.value })} />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="waive" checked={payForm.waiveLateFee}
                  onChange={(e) => setPayForm({ ...payForm, waiveLateFee: e.target.checked })} />
                <label htmlFor="waive" className="text-sm text-gray-700">Waive Late Fee</label>
              </div>
              <button type="submit" disabled={collecting || !payForm.feeAssignmentId} className="btn-primary w-full">
                {collecting ? "Processing..." : "Collect Payment"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
