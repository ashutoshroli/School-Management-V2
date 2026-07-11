"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { GraduationCap, CreditCard, Users, ArrowLeft, Edit, BadgeCheck, FileText, Trash2, Award, Plus, ToggleLeft, ToggleRight, IndianRupee, ClipboardCheck, Download, KeyRound, Copy, Check, AlertTriangle, Undo2 } from "lucide-react";
import api from "@/lib/api";
import { formatDate, formatCurrency } from "@/lib/utils";
import { openPdfInNewTab } from "@/lib/pdf";
import { resolveUploadUrl } from "@/lib/uploads";
import FileUploadButton from "@/components/ui/FileUploadButton";
import Modal from "@/components/ui/Modal";
import { useAuth } from "@/hooks/useAuth";

const ATTENDANCE_STATUS_COLORS: Record<string, string> = {
  PRESENT: "bg-green-100 text-green-700",
  ABSENT: "bg-red-100 text-red-700",
  HALF_DAY: "bg-yellow-100 text-yellow-700",
  LATE: "bg-orange-100 text-orange-700",
};

// yyyy-mm-dd for an HTML date input, from either an ISO string or a Date.
const toDateInputValue = (value: string | Date | null | undefined): string =>
  value ? new Date(value).toISOString().slice(0, 10) : "";

const GENDERS = ["MALE", "FEMALE", "OTHER"];
const DISCOUNT_TYPES = ["SIBLING", "MERIT_SCHOLARSHIP", "RTE", "STAFF_WARD", "CUSTOM"];

export default function StudentProfilePage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  // Refunds are ADMIN-only server-side (see fee.routes.ts's
  // POST /fees/refund) - an Accountant can view/collect payments but
  // not reverse them, so the Refund button is hidden for everyone else
  // rather than showing an action that would just 403.
  const isAdmin = user?.role === "SUPER_ADMIN" || user?.role === "BRANCH_ADMIN";
  const [student, setStudent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [classes, setClasses] = useState<any[]>([]);
  const [showEditModal, setShowEditModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "", phone: "", classId: "", sectionId: "", rollNo: "",
    dateOfBirth: "", gender: "MALE", bloodGroup: "", religion: "", caste: "",
    category: "", nationality: "", motherTongue: "",
    address: "", city: "", state: "", pincode: "", cardId: "", isActive: true,
  });

  // Fee details (pending fees + payment history)
  const [pendingFees, setPendingFees] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [feesLoading, setFeesLoading] = useState(true);
  const [feesError, setFeesError] = useState<string | null>(null);

  // Attendance details (monthly, same as My Attendance)
  const [attendanceMonth, setAttendanceMonth] = useState(new Date().getMonth() + 1);
  const [attendanceYear, setAttendanceYear] = useState(new Date().getFullYear());
  const [attendanceData, setAttendanceData] = useState<{ records: any[]; summary: any } | null>(null);
  const [attendanceLoading, setAttendanceLoading] = useState(true);

  useEffect(() => {
    const fetchStudent = async () => {
      try {
        const res = await api.get(`/students/${params.id}`);
        setStudent(res.data.data);
      } catch (err) {
        alert("Student not found");
        router.push("/dashboard/students");
      } finally {
        setLoading(false);
      }
    };
    fetchStudent();
    api.get("/classes").then((r) => setClasses(r.data.data || [])).catch(() => {});
  }, [params.id, router]);

  const refetchStudent = async () => {
    const res = await api.get(`/students/${params.id}`);
    setStudent(res.data.data);
  };

  const loadFees = async () => {
    setFeesLoading(true);
    setFeesError(null);
    try {
      const [pendingRes, paymentsRes] = await Promise.all([
        api.get(`/fees/pending/${params.id}`),
        api.get(`/fees/payments/${params.id}`),
      ]);
      setPendingFees(pendingRes.data.data || []);
      setPayments(paymentsRes.data.data || []);
    } catch (err: any) {
      setPendingFees([]);
      setPayments([]);
      // Teachers can view a student's profile but fee data is
      // Admin/Accountant-only (see fee.routes.ts's PAYERS list) - show
      // an honest "no access" message rather than silently rendering
      // "No pending fees - all paid up", which would be misleading.
      setFeesError(
        err.response?.status === 403
          ? "You don't have permission to view fee details for this student."
          : "Failed to load fee details."
      );
    } finally {
      setFeesLoading(false);
    }
  };

  useEffect(() => {
    loadFees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  const loadAttendance = async () => {
    setAttendanceLoading(true);
    try {
      const res = await api.get(`/academics/attendance/student/${params.id}`, {
        params: { month: attendanceMonth, year: attendanceYear },
      });
      setAttendanceData(res.data.data);
    } catch (err) {
      setAttendanceData(null);
    } finally {
      setAttendanceLoading(false);
    }
  };

  useEffect(() => {
    loadAttendance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, attendanceMonth, attendanceYear]);

  const totalPending = pendingFees.reduce((sum, f) => sum + f.pendingAmount, 0);

  const openEditModal = () => {
    setEditForm({
      name: student.user.name || "",
      phone: student.user.phone || "",
      classId: student.class?.id || "",
      sectionId: student.section?.id || "",
      rollNo: student.rollNo || "",
      dateOfBirth: toDateInputValue(student.dateOfBirth),
      gender: student.gender || "MALE",
      bloodGroup: student.bloodGroup || "",
      religion: student.religion || "",
      caste: student.caste || "",
      category: student.category || "",
      nationality: student.nationality || "",
      motherTongue: student.motherTongue || "",
      address: student.address || "",
      city: student.city || "",
      state: student.state || "",
      pincode: student.pincode || "",
      cardId: student.cardId || "",
      isActive: student.isActive,
    });
    setShowEditModal(true);
  };

  const selectedClass = classes.find((c) => c.id === editForm.classId);

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put(`/students/${params.id}`, editForm);
      setShowEditModal(false);
      await refetchStudent();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to update student");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    if (!confirm("Delete this document?")) return;
    try {
      await api.delete(`/students/${params.id}/documents/${docId}`);
      await refetchStudent();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to delete document");
    }
  };

  // Reset Password - two-step: a confirmation prompt, then (only on
  // success) a one-time reveal modal showing the new plaintext
  // password exactly once (the backend never returns it again after
  // this response, and never stores it in plaintext anywhere).
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [oneTimePassword, setOneTimePassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleResetPassword = async () => {
    setResetting(true);
    try {
      const res = await api.post(`/students/${params.id}/reset-password`);
      setShowResetConfirm(false);
      setOneTimePassword(res.data.data.oneTimePassword);
      setCopied(false);
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to reset password");
    } finally {
      setResetting(false);
    }
  };

  const copyOneTimePassword = () => {
    if (!oneTimePassword) return;
    navigator.clipboard.writeText(oneTimePassword).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [discountForm, setDiscountForm] = useState({ type: "SIBLING", name: "Sibling Discount", value: "", isPercent: false });

  const handleAddDiscount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/fees/discounts", {
        studentId: params.id,
        type: discountForm.type,
        name: discountForm.name,
        value: parseFloat(discountForm.value),
        isPercent: discountForm.isPercent,
      });
      setShowDiscountModal(false);
      setDiscountForm({ type: "SIBLING", name: "Sibling Discount", value: "", isPercent: false });
      await refetchStudent();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to add discount");
    }
  };

  const toggleDiscount = async (id: string) => {
    try {
      await api.patch(`/fees/discounts/${id}/toggle`);
      await refetchStudent();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to toggle discount");
    }
  };

  const deleteDiscount = async (id: string) => {
    if (!confirm("Remove this discount?")) return;
    try {
      await api.delete(`/fees/discounts/${id}`);
      await refetchStudent();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to remove discount");
    }
  };

  // Refund - opens with the target payment pre-selected; amount
  // defaults to the full payment amount but can be reduced for a
  // partial refund (backend rejects amount > payment.amount).
  const [refundPayment, setRefundPayment] = useState<any>(null);
  const [refundForm, setRefundForm] = useState({ amount: "", reason: "" });
  const [refunding, setRefunding] = useState(false);

  const openRefundModal = (payment: any) => {
    setRefundPayment(payment);
    setRefundForm({ amount: String(payment.amount), reason: "" });
  };

  const handleRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!refundPayment) return;
    setRefunding(true);
    try {
      await api.post("/fees/refund", {
        paymentId: refundPayment.id,
        amount: parseFloat(refundForm.amount),
        reason: refundForm.reason,
      });
      setRefundPayment(null);
      await loadFees();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to process refund");
    } finally {
      setRefunding(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!student) return null;

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="p-2 rounded-lg hover:bg-gray-100">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">{student.user.name}</h1>
          <p className="text-gray-500">Admission No: {student.admissionNo}</p>
        </div>
        <button
          onClick={() => openPdfInNewTab(`/students/${params.id}/id-card`)}
          className="btn-secondary flex items-center gap-2"
        >
          <BadgeCheck className="h-4 w-4" /> ID Card
        </button>
        <Link href="/dashboard/certificates" className="btn-secondary flex items-center gap-2">
          <Award className="h-4 w-4" /> Certificates
        </Link>
        <button onClick={() => setShowResetConfirm(true)} className="btn-secondary flex items-center gap-2">
          <KeyRound className="h-4 w-4" /> Reset Password
        </button>
        <button onClick={openEditModal} className="btn-primary flex items-center gap-2">
          <Edit className="h-4 w-4" /> Edit
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Info */}
        <div className="lg:col-span-2 space-y-6">
          <div className="card">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-primary-600" /> Student Details
            </h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-500">Class:</span> <span className="font-medium ml-2">{student.class?.name} - {student.section?.name}</span></div>
              <div><span className="text-gray-500">Roll No:</span> <span className="font-medium ml-2">{student.rollNo || "Not assigned"}</span></div>
              <div><span className="text-gray-500">DOB:</span> <span className="font-medium ml-2">{formatDate(student.dateOfBirth)}</span></div>
              <div><span className="text-gray-500">Gender:</span> <span className="font-medium ml-2">{student.gender}</span></div>
              <div><span className="text-gray-500">Blood Group:</span> <span className="font-medium ml-2">{student.bloodGroup || "-"}</span></div>
              <div><span className="text-gray-500">Category:</span> <span className="font-medium ml-2">{student.category || "-"}</span></div>
              <div><span className="text-gray-500">Religion:</span> <span className="font-medium ml-2">{student.religion || "-"}</span></div>
              <div><span className="text-gray-500">Nationality:</span> <span className="font-medium ml-2">{student.nationality}</span></div>
              <div><span className="text-gray-500">Email:</span> <span className="font-medium ml-2">{student.user.email}</span></div>
              <div><span className="text-gray-500">Phone:</span> <span className="font-medium ml-2">{student.user.phone || "-"}</span></div>
              <div><span className="text-gray-500">Admission Date:</span> <span className="font-medium ml-2">{formatDate(student.admissionDate)}</span></div>
              <div><span className="text-gray-500">Previous School:</span> <span className="font-medium ml-2">{student.previousSchool || "-"}</span></div>
            </div>
          </div>

          {/* Fee Details */}
          <div className="card">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <IndianRupee className="h-5 w-5 text-green-600" /> Fee Details
              </h3>
              <Link href="/dashboard/fees/collect" className="text-sm text-primary-600 hover:underline font-medium">
                Collect Payment &rarr;
              </Link>
            </div>
            {feesLoading ? (
              <div className="flex justify-center py-6">
                <div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" />
              </div>
            ) : feesError ? (
              <p className="text-sm text-gray-400">{feesError}</p>
            ) : (
              <>
                <div className="flex items-center justify-between bg-gray-50 rounded-lg p-3 mb-4">
                  <span className="text-sm text-gray-600">Total Pending</span>
                  <span className={`text-lg font-bold ${totalPending > 0 ? "text-red-600" : "text-green-600"}`}>
                    {formatCurrency(totalPending)}
                  </span>
                </div>

                <h4 className="text-sm font-semibold text-gray-600 mb-2">Pending Fees</h4>
                {pendingFees.length === 0 ? (
                  <p className="text-sm text-green-600 font-medium mb-4">No pending fees - all paid up.</p>
                ) : (
                  <div className="space-y-2 mb-4">
                    {pendingFees.map((fee: any) => (
                      <div key={fee.id} className="border rounded-lg p-3 flex items-center justify-between flex-wrap gap-2">
                        <div>
                          <p className="font-medium text-sm">{fee.feeStructure.feeCategory.name}</p>
                          <p className="text-xs text-gray-500">
                            {fee.feeStructure.class?.name || `Transport: ${fee.feeStructure.transportRoute?.name}`} &bull; {fee.feeStructure.frequency}
                          </p>
                          {fee.calculatedLateFee > 0 && (
                            <p className="text-xs text-orange-600 mt-0.5">Includes late fee: {formatCurrency(fee.calculatedLateFee)}</p>
                          )}
                        </div>
                        <p className="font-bold text-red-600">{formatCurrency(fee.pendingAmount)}</p>
                      </div>
                    ))}
                  </div>
                )}

                <h4 className="text-sm font-semibold text-gray-600 mb-2">Payment History</h4>
                {payments.length === 0 ? (
                  <p className="text-sm text-gray-400">No payments recorded yet</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-gray-50">
                          <th className="px-3 py-2 text-left">Receipt No</th>
                          <th className="px-3 py-2 text-left">Category</th>
                          <th className="px-3 py-2 text-left">Date</th>
                          <th className="px-3 py-2 text-left">Amount</th>
                          <th className="px-3 py-2 text-left">Mode</th>
                          <th className="px-3 py-2 text-left">Status</th>
                          <th className="px-3 py-2 text-center">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payments.map((p: any) => (
                          <tr key={p.id} className="border-b hover:bg-gray-50">
                            <td className="px-3 py-2 font-mono text-xs">{p.receiptNo}</td>
                            <td className="px-3 py-2">{p.feeAssignment?.feeStructure?.feeCategory?.name || "-"}</td>
                            <td className="px-3 py-2">{formatDate(p.paidAt)}</td>
                            <td className="px-3 py-2 font-medium">{formatCurrency(Number(p.amount))}</td>
                            <td className="px-3 py-2">{p.paymentMode.replace(/_/g, " ")}</td>
                            <td className="px-3 py-2">
                              {p.status === "REFUNDED" ? (
                                <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">Refunded</span>
                              ) : (
                                <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full">{p.status}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <div className="flex items-center justify-center gap-3">
                                <button
                                  onClick={() => openPdfInNewTab(`/fees/payments/${p.id}/receipt`)}
                                  className="inline-flex items-center gap-1 text-primary-600 text-xs font-medium hover:underline"
                                >
                                  <Download className="h-3.5 w-3.5" /> Receipt
                                </button>
                                {isAdmin && p.status !== "REFUNDED" && (
                                  <button
                                    onClick={() => openRefundModal(p)}
                                    className="inline-flex items-center gap-1 text-red-500 text-xs font-medium hover:underline"
                                  >
                                    <Undo2 className="h-3.5 w-3.5" /> Refund
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Attendance Details */}
          <div className="card">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <ClipboardCheck className="h-5 w-5 text-blue-600" /> Attendance Details
              </h3>
              <div className="flex gap-2">
                <select className="input-field w-auto text-sm" value={attendanceMonth} onChange={(e) => setAttendanceMonth(Number(e.target.value))}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>{new Date(2000, m - 1).toLocaleString("en", { month: "long" })}</option>
                  ))}
                </select>
                <select className="input-field w-auto text-sm" value={attendanceYear} onChange={(e) => setAttendanceYear(Number(e.target.value))}>
                  {[attendanceYear - 1, attendanceYear, attendanceYear + 1].map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            </div>
            {attendanceLoading ? (
              <div className="flex justify-center py-6">
                <div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" />
              </div>
            ) : attendanceData ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                  <div className="bg-gray-50 rounded-lg text-center py-2">
                    <p className="text-xl font-bold text-primary-600">{attendanceData.summary.percentage}%</p>
                    <p className="text-xs text-gray-500 mt-0.5">Attendance</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg text-center py-2">
                    <p className="text-xl font-bold text-green-600">{attendanceData.summary.present}</p>
                    <p className="text-xs text-gray-500 mt-0.5">Present</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg text-center py-2">
                    <p className="text-xl font-bold text-red-600">{attendanceData.summary.absent}</p>
                    <p className="text-xs text-gray-500 mt-0.5">Absent</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg text-center py-2">
                    <p className="text-xl font-bold text-orange-600">{attendanceData.summary.late}</p>
                    <p className="text-xs text-gray-500 mt-0.5">Late</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg text-center py-2">
                    <p className="text-xl font-bold text-yellow-600">{attendanceData.summary.halfDay}</p>
                    <p className="text-xs text-gray-500 mt-0.5">Half Day</p>
                  </div>
                </div>

                {attendanceData.records.length === 0 ? (
                  <p className="text-sm text-gray-400">No attendance records for this month yet</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {attendanceData.records.map((r: any) => (
                      <div key={r.id} className={`px-3 py-2 rounded-lg text-sm flex justify-between ${ATTENDANCE_STATUS_COLORS[r.status] || "bg-gray-100"}`}>
                        <span>{formatDate(r.date)}</span>
                        <span className="font-medium">{r.status.replace("_", " ")}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-400">No attendance data available</p>
            )}
          </div>

          {/* Address */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-3">Address</h3>
            <p className="text-sm text-gray-700">
              {student.address || "-"}, {student.city} {student.state} {student.pincode}
            </p>
          </div>

          {/* Parents */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Users className="h-5 w-5 text-green-600" /> Parents / Guardians
            </h3>
            <div className="space-y-3">
              {student.parents?.map((link: any) => (
                <div key={link.id} className="flex items-center justify-between bg-gray-50 p-3 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">{link.parent.user.name}</p>
                    <p className="text-sm text-gray-500">{link.parent.relation} &bull; {link.parent.user.email}</p>
                  </div>
                  <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full">
                    {link.parent.user.phone || "No phone"}
                  </span>
                </div>
              ))}
              {(!student.parents || student.parents.length === 0) && (
                <p className="text-sm text-gray-400">No parents linked</p>
              )}
            </div>
          </div>

          {/* Documents */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <FileText className="h-5 w-5 text-blue-600" /> Documents
              </h3>
              <div className="flex gap-2">
                {["photo", "birth_cert", "aadhar", "tc", "marksheet"].map((docType) => (
                  <FileUploadButton
                    key={docType}
                    uploadPath={`/students/${params.id}/documents`}
                    extraFields={{ type: docType }}
                    label={docType.replace("_", " ")}
                    onUploaded={refetchStudent}
                    className="text-xs px-2 py-1"
                  />
                ))}
              </div>
            </div>
            <div className="space-y-2">
              {student.documents?.map((doc: any) => (
                <div key={doc.id} className="flex items-center justify-between bg-gray-50 p-3 rounded-lg">
                  <div>
                    <a href={resolveUploadUrl(doc.fileUrl)} target="_blank" rel="noreferrer" className="font-medium text-primary-600 hover:underline">
                      {doc.name}
                    </a>
                    <p className="text-xs text-gray-500">{doc.type.replace("_", " ")} &bull; {formatDate(doc.createdAt)}</p>
                  </div>
                  <button onClick={() => handleDeleteDocument(doc.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {(!student.documents || student.documents.length === 0) && (
                <p className="text-sm text-gray-400">No documents uploaded yet</p>
              )}
            </div>
          </div>
        </div>

        {/* Side Panel */}
        <div className="space-y-6">
          {/* RFID Card */}
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-600 mb-2 flex items-center gap-2">
              <CreditCard className="h-4 w-4" /> RFID Card
            </h3>
            {student.cardId ? (
              <div className="bg-green-50 text-green-700 text-sm font-mono p-3 rounded-lg">
                {student.cardId}
              </div>
            ) : (
              <p className="text-sm text-gray-400">Not assigned</p>
            )}
          </div>

          {/* Discounts */}
          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-600">Discounts / Scholarships</h3>
              <button onClick={() => setShowDiscountModal(true)} className="text-primary-600 hover:text-primary-700" title="Add discount">
                <Plus className="h-4 w-4" />
              </button>
            </div>
            {student.discounts?.length > 0 ? (
              <div className="space-y-2">
                {student.discounts.map((d: any) => (
                  <div key={d.id} className={`text-sm p-2 rounded flex items-center justify-between ${d.isActive ? "bg-purple-50" : "bg-gray-50 opacity-60"}`}>
                    <div>
                      <span className="font-medium">{d.name}</span>
                      <span className="text-purple-700 ml-2">
                        {d.isPercent ? `${d.value}%` : `Rs ${d.value}`}
                      </span>
                      {!d.isActive && <span className="text-xs text-gray-400 ml-2">(inactive)</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => toggleDiscount(d.id)} title={d.isActive ? "Deactivate" : "Activate"} className="text-gray-500 hover:text-gray-700">
                        {d.isActive ? <ToggleRight className="h-4 w-4 text-green-600" /> : <ToggleLeft className="h-4 w-4" />}
                      </button>
                      <button onClick={() => deleteDiscount(d.id)} title="Remove" className="text-red-500 hover:text-red-700">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">None</p>
            )}
          </div>

          {/* Status */}
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-600 mb-2">Status</h3>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${student.isActive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
              {student.isActive ? "Active" : "Left / Inactive"}
            </span>
          </div>
        </div>
      </div>

      <Modal isOpen={showEditModal} onClose={() => setShowEditModal(false)} title="Edit Student" size="lg">
        <form onSubmit={handleSaveEdit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input className="input-field" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Phone</label>
              <input className="input-field" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Class</label>
              <select
                className="input-field"
                value={editForm.classId}
                onChange={(e) => setEditForm({ ...editForm, classId: e.target.value, sectionId: "" })}
              >
                <option value="">Select</option>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Section</label>
              <select className="input-field" value={editForm.sectionId} onChange={(e) => setEditForm({ ...editForm, sectionId: e.target.value })}>
                <option value="">Select</option>
                {(selectedClass?.sections || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Roll No</label>
              <input className="input-field" value={editForm.rollNo} onChange={(e) => setEditForm({ ...editForm, rollNo: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Date of Birth</label>
              <input type="date" className="input-field" value={editForm.dateOfBirth} onChange={(e) => setEditForm({ ...editForm, dateOfBirth: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Gender</label>
              <select className="input-field" value={editForm.gender} onChange={(e) => setEditForm({ ...editForm, gender: e.target.value })}>
                {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Blood Group</label>
              <input className="input-field" value={editForm.bloodGroup} onChange={(e) => setEditForm({ ...editForm, bloodGroup: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Religion</label>
              <input className="input-field" value={editForm.religion} onChange={(e) => setEditForm({ ...editForm, religion: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Caste</label>
              <input className="input-field" value={editForm.caste} onChange={(e) => setEditForm({ ...editForm, caste: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Category</label>
              <input className="input-field" value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Nationality</label>
              <input className="input-field" value={editForm.nationality} onChange={(e) => setEditForm({ ...editForm, nationality: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Mother Tongue</label>
              <input className="input-field" value={editForm.motherTongue} onChange={(e) => setEditForm({ ...editForm, motherTongue: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">RFID Card ID</label>
              <input className="input-field" value={editForm.cardId} onChange={(e) => setEditForm({ ...editForm, cardId: e.target.value })} placeholder="Leave blank if none" />
            </div>
            <div className="flex items-center gap-2 mt-6">
              <input
                type="checkbox"
                id="isActive"
                checked={editForm.isActive}
                onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })}
              />
              <label htmlFor="isActive" className="text-sm font-medium">Active</label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Address</label>
            <input className="input-field" value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">City</label>
              <input className="input-field" value={editForm.city} onChange={(e) => setEditForm({ ...editForm, city: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">State</label>
              <input className="input-field" value={editForm.state} onChange={(e) => setEditForm({ ...editForm, state: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Pincode</label>
              <input className="input-field" value={editForm.pincode} onChange={(e) => setEditForm({ ...editForm, pincode: e.target.value })} />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setShowEditModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary disabled:opacity-50">{saving ? "Saving..." : "Save Changes"}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={showResetConfirm} onClose={() => setShowResetConfirm(false)} title="Reset Password">
        <div className="space-y-4">
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800">
              This immediately replaces {student.user.name}'s login password with a new randomly-generated
              one-time password. Their current password (if any) will stop working right away.
            </p>
          </div>
          <p className="text-sm text-gray-600">
            The new password will be shown to you <span className="font-medium">once</span> - copy it and share it
            with the student/parent. It cannot be retrieved again afterwards.
          </p>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setShowResetConfirm(false)} className="btn-secondary">Cancel</button>
            <button type="button" onClick={handleResetPassword} disabled={resetting} className="btn-primary disabled:opacity-50">
              {resetting ? "Resetting..." : "Reset Password"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!oneTimePassword} onClose={() => setOneTimePassword(null)} title="One-Time Password Generated">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Share this password with <span className="font-medium">{student.user.name}</span> ({student.user.email}) now.
            It will <span className="font-medium">not be shown again</span> after you close this window.
          </p>
          <div className="flex items-center gap-2 bg-gray-50 border rounded-lg p-3">
            <code className="flex-1 text-lg font-mono font-semibold tracking-wide text-gray-900">{oneTimePassword}</code>
            <button
              type="button"
              onClick={copyOneTimePassword}
              title="Copy to clipboard"
              className={`p-2 rounded-lg ${copied ? "text-green-600 bg-green-50" : "text-gray-500 hover:bg-gray-100"}`}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          {copied && <p className="text-xs text-green-600">Copied to clipboard.</p>}
          <p className="text-xs text-gray-500">
            The student/parent should change this password after logging in (Settings &gt; Change Password).
          </p>
          <div className="flex justify-end pt-4 border-t">
            <button type="button" onClick={() => setOneTimePassword(null)} className="btn-primary">I've saved this - Close</button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showDiscountModal} onClose={() => setShowDiscountModal(false)} title="Add Discount / Scholarship">
        <form onSubmit={handleAddDiscount} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Type *</label>
            <select
              className="input-field"
              value={discountForm.type}
              onChange={(e) => setDiscountForm({ ...discountForm, type: e.target.value })}
            >
              {DISCOUNT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Display Name *</label>
            <input className="input-field" value={discountForm.name} onChange={(e) => setDiscountForm({ ...discountForm, name: e.target.value })} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Value *</label>
              <input type="number" className="input-field" value={discountForm.value} onChange={(e) => setDiscountForm({ ...discountForm, value: e.target.value })} required />
            </div>
            <div className="flex items-center gap-2 mt-6">
              <input
                type="checkbox"
                id="isPercent"
                checked={discountForm.isPercent}
                onChange={(e) => setDiscountForm({ ...discountForm, isPercent: e.target.checked })}
              />
              <label htmlFor="isPercent" className="text-sm font-medium">Value is a percentage (%)</label>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setShowDiscountModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">Add Discount</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!refundPayment} onClose={() => setRefundPayment(null)} title={`Refund Receipt ${refundPayment?.receiptNo || ""}`}>
        <form onSubmit={handleRefund} className="space-y-4">
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800">
              This marks the payment as refunded and reduces the student's paid amount for this fee accordingly. It
              does not itself move money - process the actual refund (cash/bank transfer/gateway) separately.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Refund Amount (Rs) *</label>
            <input
              type="number"
              min="0"
              max={refundPayment?.amount}
              step="0.01"
              className="input-field"
              value={refundForm.amount}
              onChange={(e) => setRefundForm({ ...refundForm, amount: e.target.value })}
              required
            />
            <p className="text-xs text-gray-400 mt-1">Original payment: {formatCurrency(Number(refundPayment?.amount || 0))}</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Reason *</label>
            <textarea
              className="input-field"
              rows={2}
              value={refundForm.reason}
              onChange={(e) => setRefundForm({ ...refundForm, reason: e.target.value })}
              placeholder="e.g. Overpayment, student withdrawn, duplicate payment..."
              required
            />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setRefundPayment(null)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={refunding} className="btn-primary disabled:opacity-50">
              {refunding ? "Processing..." : "Process Refund"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
