"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Users, CreditCard, ArrowLeft, Edit, BadgeCheck, FileText, Trash2, IndianRupee, ClipboardCheck, KeyRound, Copy, Check, AlertTriangle, Calendar } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { formatDate, formatCurrency } from "@/lib/utils";
import { openPdfInNewTab } from "@/lib/pdf";
import { resolveUploadUrl } from "@/lib/uploads";
import FileUploadButton from "@/components/ui/FileUploadButton";
import Modal from "@/components/ui/Modal";

const ATTENDANCE_STATUS_COLORS: Record<string, string> = {
  PRESENT: "bg-green-100 text-green-700",
  ABSENT: "bg-red-100 text-red-700",
  HALF_DAY: "bg-yellow-100 text-yellow-700",
  LATE: "bg-orange-100 text-orange-700",
  ON_LEAVE: "bg-blue-100 text-blue-700",
};

const LEAVE_STATUS_COLORS: Record<string, string> = {
  APPROVED: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-700",
  PENDING: "bg-yellow-100 text-yellow-700",
  CANCELLED: "bg-gray-100 text-gray-600",
};

export default function StaffProfilePage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === "SUPER_ADMIN" || user?.role === "BRANCH_ADMIN";

  const [staff, setStaff] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showEditModal, setShowEditModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "", phone: "", designation: "", department: "", type: "TEACHING",
    qualification: "", experience: "",
    bankAccount: "", bankName: "", ifscCode: "", panNumber: "", aadharNumber: "",
    address: "", city: "", state: "", pincode: "", cardId: "", isActive: true, leavingDate: "",
    // Point 10: free-text label, only meaningful when this staff
    // member's System Role is "Others" (STAFF role) - blank for every
    // normal role.
    customStaffType: "",
    // Point 3a: per-teacher daily period cap - blank/0 = no limit.
    maxPeriodsPerDay: "",
  });

  // Salary structure (admin only)
  const [salary, setSalary] = useState<any>(null);
  const [salaryLoading, setSalaryLoading] = useState(true);

  // Attendance (monthly, same convention as the student profile page)
  const [attendanceMonth, setAttendanceMonth] = useState(new Date().getMonth() + 1);
  const [attendanceYear, setAttendanceYear] = useState(new Date().getFullYear());
  const [attendanceData, setAttendanceData] = useState<{ records: any[]; summary: any } | null>(null);
  const [attendanceLoading, setAttendanceLoading] = useState(true);

  // Leave applications + balance
  const [leaveApplications, setLeaveApplications] = useState<any[]>([]);
  const [leaveBalance, setLeaveBalance] = useState<any[]>([]);
  const [leaveLoading, setLeaveLoading] = useState(true);

  useEffect(() => {
    const fetchStaff = async () => {
      try {
        const res = await api.get(`/staff/${params.id}`);
        setStaff(res.data.data);
      } catch (err) {
        alert("Staff member not found");
        router.push("/dashboard/staff");
      } finally {
        setLoading(false);
      }
    };
    fetchStaff();
  }, [params.id, router]);

  const refetchStaff = async () => {
    const res = await api.get(`/staff/${params.id}`);
    setStaff(res.data.data);
  };

  const loadSalary = async () => {
    if (!isAdmin) { setSalaryLoading(false); return; }
    setSalaryLoading(true);
    try {
      const res = await api.get(`/hr/salary-structure/${params.id}`);
      setSalary(res.data.data);
    } catch {
      setSalary(null);
    } finally {
      setSalaryLoading(false);
    }
  };

  useEffect(() => {
    loadSalary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  const loadAttendance = async () => {
    setAttendanceLoading(true);
    try {
      const res = await api.get(`/hr/attendance/calendar/${params.id}`, {
        params: { month: attendanceMonth, year: attendanceYear },
      });
      setAttendanceData(res.data.data);
    } catch {
      setAttendanceData(null);
    } finally {
      setAttendanceLoading(false);
    }
  };

  useEffect(() => {
    loadAttendance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, attendanceMonth, attendanceYear]);

  const loadLeave = async () => {
    setLeaveLoading(true);
    try {
      const [appsRes, balanceRes] = await Promise.all([
        api.get("/hr/leave/applications", { params: { staffId: params.id } }),
        api.get(`/hr/leave/balance/${params.id}`),
      ]);
      setLeaveApplications(appsRes.data.data || []);
      setLeaveBalance(balanceRes.data.data || []);
    } catch {
      setLeaveApplications([]);
      setLeaveBalance([]);
    } finally {
      setLeaveLoading(false);
    }
  };

  useEffect(() => {
    loadLeave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  const openEditModal = () => {
    setEditForm({
      name: staff.user.name || "",
      phone: staff.user.phone || "",
      designation: staff.designation || "",
      department: staff.department || "",
      type: staff.type || "TEACHING",
      qualification: staff.qualification || "",
      experience: staff.experience || "",
      bankAccount: staff.bankAccount || "",
      bankName: staff.bankName || "",
      ifscCode: staff.ifscCode || "",
      panNumber: staff.panNumber || "",
      aadharNumber: staff.aadharNumber || "",
      address: staff.address || "",
      city: staff.city || "",
      state: staff.state || "",
      pincode: staff.pincode || "",
      cardId: staff.cardId || "",
      isActive: staff.isActive,
      leavingDate: staff.leavingDate ? new Date(staff.leavingDate).toISOString().slice(0, 10) : "",
      // Point 2 (auto-tick/pre-fill): loaded straight from the saved
      // Staff record, same as every other field in this form, so
      // re-opening Edit always shows the DB's current value, not a
      // blank default.
      customStaffType: staff.customStaffType || "",
      maxPeriodsPerDay: staff.maxPeriodsPerDay ? String(staff.maxPeriodsPerDay) : "",
    });
    setShowEditModal(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put(`/staff/${params.id}`, {
        ...editForm,
        maxPeriodsPerDay: editForm.maxPeriodsPerDay === "" ? null : parseInt(editForm.maxPeriodsPerDay, 10),
      });
      setShowEditModal(false);
      await refetchStaff();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to update staff member");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    if (!confirm("Delete this document?")) return;
    try {
      await api.delete(`/staff/${params.id}/documents/${docId}`);
      await refetchStaff();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to delete document");
    }
  };

  // Reset Password - same two-step confirm-then-reveal-once flow as
  // the student profile page (see its comment for the security
  // rationale: the plaintext is shown exactly once and never again).
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [oneTimePassword, setOneTimePassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleResetPassword = async () => {
    setResetting(true);
    try {
      const res = await api.post(`/staff/${params.id}/reset-password`);
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

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!staff) return null;

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <button onClick={() => router.back()} className="p-2 rounded-lg hover:bg-gray-100">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">{staff.user.name}</h1>
          <p className="text-gray-500">Employee ID: {staff.employeeId}</p>
        </div>
        <button
          onClick={() => openPdfInNewTab(`/staff/${params.id}/id-card`)}
          className="btn-secondary flex items-center gap-2"
        >
          <BadgeCheck className="h-4 w-4" /> ID Card
        </button>
        {isAdmin && (
          <button onClick={() => setShowResetConfirm(true)} className="btn-secondary flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> Reset Password
          </button>
        )}
        {isAdmin && (
          <button onClick={openEditModal} className="btn-primary flex items-center gap-2">
            <Edit className="h-4 w-4" /> Edit
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Info */}
        <div className="lg:col-span-2 space-y-6">
          <div className="card">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Users className="h-5 w-5 text-primary-600" /> Staff Details
            </h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-500">Designation:</span> <span className="font-medium ml-2">{staff.designation}</span></div>
              <div><span className="text-gray-500">Department:</span> <span className="font-medium ml-2">{staff.department}</span></div>
              <div>
                <span className="text-gray-500">Type:</span>
                <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${staff.type === "TEACHING" ? "bg-blue-100 text-blue-700" : "bg-orange-100 text-orange-700"}`}>
                  {staff.type === "TEACHING" ? "Teaching" : "Non-Teaching"}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Role:</span>
                <span className="font-medium ml-2">
                  {staff.user.role?.replace(/_/g, " ")}{staff.customStaffType ? ` (${staff.customStaffType})` : ""}
                </span>
              </div>
              {staff.type === "TEACHING" && (
                <div><span className="text-gray-500">Max Periods/Day:</span> <span className="font-medium ml-2">{staff.maxPeriodsPerDay || "No limit"}</span></div>
              )}
              <div><span className="text-gray-500">Qualification:</span> <span className="font-medium ml-2">{staff.qualification || "-"}</span></div>
              <div><span className="text-gray-500">Experience:</span> <span className="font-medium ml-2">{staff.experience || "-"}</span></div>
              <div><span className="text-gray-500">Joining Date:</span> <span className="font-medium ml-2">{formatDate(staff.joiningDate)}</span></div>
              {staff.leavingDate && (
                <div><span className="text-gray-500">Leaving Date:</span> <span className="font-medium ml-2">{formatDate(staff.leavingDate)}</span></div>
              )}
              <div><span className="text-gray-500">Email:</span> <span className="font-medium ml-2">{staff.user.email}</span></div>
              <div><span className="text-gray-500">Phone:</span> <span className="font-medium ml-2">{staff.user.phone || "-"}</span></div>
              <div><span className="text-gray-500">Branch:</span> <span className="font-medium ml-2">{staff.branch?.name}</span></div>
              {isAdmin && (
                <>
                  <div><span className="text-gray-500">PAN:</span> <span className="font-medium ml-2">{staff.panNumber || "-"}</span></div>
                  <div><span className="text-gray-500">Aadhar:</span> <span className="font-medium ml-2">{staff.aadharNumber || "-"}</span></div>
                  <div><span className="text-gray-500">Bank Account:</span> <span className="font-medium ml-2">{staff.bankAccount || "-"}</span></div>
                  <div><span className="text-gray-500">Bank / IFSC:</span> <span className="font-medium ml-2">{staff.bankName ? `${staff.bankName} / ${staff.ifscCode || "-"}` : "-"}</span></div>
                </>
              )}
            </div>
          </div>

          {/* Salary Structure (admin only - sensitive) */}
          {isAdmin && (
            <div className="card">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <IndianRupee className="h-5 w-5 text-green-600" /> Salary Structure
                </h3>
                <Link href="/dashboard/payroll/salary-structure" className="text-sm text-primary-600 hover:underline font-medium">
                  {salary ? "Edit" : "Set up"} Salary &rarr;
                </Link>
              </div>
              {salaryLoading ? (
                <div className="flex justify-center py-6">
                  <div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" />
                </div>
              ) : salary ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                  <div className="bg-gray-50 rounded-lg px-3 py-2">
                    <p className="text-gray-500 text-xs">Gross Salary</p>
                    <p className="font-semibold text-gray-900">{formatCurrency(Number(salary.grossSalary))}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg px-3 py-2">
                    <p className="text-gray-500 text-xs">PF (Employee)</p>
                    <p className="font-semibold text-blue-700">{formatCurrency(Number(salary.pfEmployee))}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg px-3 py-2">
                    <p className="text-gray-500 text-xs">ESI (Employee)</p>
                    <p className="font-semibold text-purple-700">{formatCurrency(Number(salary.esiEmployee))}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg px-3 py-2">
                    <p className="text-gray-500 text-xs">TDS</p>
                    <p className="font-semibold text-red-600">{formatCurrency(Number(salary.tds))}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg px-3 py-2">
                    <p className="text-gray-500 text-xs">Tax Regime</p>
                    <p className="font-semibold text-gray-900">{salary.taxRegime}</p>
                  </div>
                  <div className="bg-primary-50 rounded-lg px-3 py-2">
                    <p className="text-primary-700 text-xs">Net Salary</p>
                    <p className="font-bold text-primary-700">{formatCurrency(Number(salary.netSalary))}</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-400">No salary structure configured yet.</p>
              )}
            </div>
          )}

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
                    <p className="text-xl font-bold text-green-600">{attendanceData.summary.present}</p>
                    <p className="text-xs text-gray-500 mt-0.5">Present</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg text-center py-2">
                    <p className="text-xl font-bold text-red-600">{attendanceData.summary.absent}</p>
                    <p className="text-xs text-gray-500 mt-0.5">Absent</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg text-center py-2">
                    <p className="text-xl font-bold text-yellow-600">{attendanceData.summary.halfDay}</p>
                    <p className="text-xs text-gray-500 mt-0.5">Half Day</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg text-center py-2">
                    <p className="text-xl font-bold text-blue-600">{attendanceData.summary.onLeave}</p>
                    <p className="text-xs text-gray-500 mt-0.5">On Leave</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg text-center py-2">
                    <p className="text-xl font-bold text-gray-700">{attendanceData.summary.totalDays}</p>
                    <p className="text-xs text-gray-500 mt-0.5">Total Marked</p>
                  </div>
                </div>

                {/* Late-entry/early-exit combined penalty rule (spec
                    Section 6) - every N combined occurrences in a
                    week-cycle deducts periods from that day's
                    attendance (branch-configurable via Settings). */}
                {(attendanceData.summary.lateEntryCount > 0 || attendanceData.summary.earlyExitCount > 0 || attendanceData.summary.totalPeriodsDeducted > 0) && (
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="bg-orange-50 rounded-lg text-center py-2">
                      <p className="text-lg font-bold text-orange-600">{attendanceData.summary.lateEntryCount}</p>
                      <p className="text-xs text-gray-500 mt-0.5">Late Entries</p>
                    </div>
                    <div className="bg-orange-50 rounded-lg text-center py-2">
                      <p className="text-lg font-bold text-orange-600">{attendanceData.summary.earlyExitCount}</p>
                      <p className="text-xs text-gray-500 mt-0.5">Early Exits</p>
                    </div>
                    <div className="bg-red-50 rounded-lg text-center py-2">
                      <p className="text-lg font-bold text-red-600">{attendanceData.summary.totalPeriodsDeducted}</p>
                      <p className="text-xs text-gray-500 mt-0.5">Periods Deducted</p>
                    </div>
                  </div>
                )}

                {attendanceData.records.length === 0 ? (
                  <p className="text-sm text-gray-400">No attendance records for this month yet</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {attendanceData.records.map((r: any) => (
                      <div key={r.id} className={`px-3 py-2 rounded-lg text-sm flex justify-between items-center gap-2 ${ATTENDANCE_STATUS_COLORS[r.status] || "bg-gray-100"}`}>
                        <span>{formatDate(r.date)}</span>
                        <span className="flex items-center gap-1">
                          <span className="font-medium">{r.status.replace("_", " ")}</span>
                          {(r.isLateEntry || r.isEarlyExit) && (
                            <span title={[r.isLateEntry && "Late entry", r.isEarlyExit && "Early exit"].filter(Boolean).join(" + ")} className="text-[10px] font-bold">
                              {r.isLateEntry ? "L" : ""}{r.isEarlyExit ? "E" : ""}
                            </span>
                          )}
                          {r.periodsDeducted > 0 && (
                            <span title={`${r.periodsDeducted} period(s) deducted`} className="text-[10px] font-bold text-red-700">
                              -{r.periodsDeducted}
                            </span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-400">No attendance data available</p>
            )}
          </div>

          {/* Leave */}
          <div className="card">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Calendar className="h-5 w-5 text-purple-600" /> Leave
              </h3>
              <Link href="/dashboard/leaves" className="text-sm text-primary-600 hover:underline font-medium">
                Manage Leave &rarr;
              </Link>
            </div>
            {leaveLoading ? (
              <div className="flex justify-center py-6">
                <div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" />
              </div>
            ) : (
              <>
                <h4 className="text-sm font-semibold text-gray-600 mb-2">Leave Balance ({new Date().getFullYear()})</h4>
                {leaveBalance.length === 0 ? (
                  <p className="text-sm text-gray-400 mb-4">No leave types configured</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                    {leaveBalance.map((b: any) => (
                      <div key={b.code} className="bg-gray-50 rounded-lg text-center py-2">
                        <p className="text-lg font-bold text-primary-700">{b.remaining}</p>
                        <p className="text-xs text-gray-500">{b.leaveType} (of {b.maxDays})</p>
                      </div>
                    ))}
                  </div>
                )}

                <h4 className="text-sm font-semibold text-gray-600 mb-2">Applications</h4>
                {leaveApplications.length === 0 ? (
                  <p className="text-sm text-gray-400">No leave applications yet</p>
                ) : (
                  <div className="space-y-2">
                    {leaveApplications.map((a: any) => (
                      <div key={a.id} className="border rounded-lg p-3 flex items-center justify-between flex-wrap gap-2">
                        <div>
                          <p className="font-medium text-sm">{a.leaveType?.name} &bull; {a.days} day(s)</p>
                          <p className="text-xs text-gray-500">{formatDate(a.fromDate)} - {formatDate(a.toDate)}</p>
                          {a.reason && <p className="text-xs text-gray-400 mt-0.5">{a.reason}</p>}
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${LEAVE_STATUS_COLORS[a.status] || "bg-gray-100"}`}>
                          {a.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Address */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-3">Address</h3>
            <p className="text-sm text-gray-700">
              {staff.address || "-"}, {staff.city} {staff.state} {staff.pincode}
            </p>
          </div>

          {/* Documents */}
          <div className="card">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <FileText className="h-5 w-5 text-blue-600" /> Documents
              </h3>
              {isAdmin && (
                <div className="flex gap-2 flex-wrap">
                  {["photo", "resume", "certificate", "aadhar", "pan"].map((docType) => (
                    <FileUploadButton
                      key={docType}
                      uploadPath={`/staff/${params.id}/documents`}
                      extraFields={{ type: docType }}
                      label={docType.replace("_", " ")}
                      onUploaded={refetchStaff}
                      className="text-xs px-2 py-1"
                    />
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2">
              {staff.documents?.map((doc: any) => (
                <div key={doc.id} className="flex items-center justify-between bg-gray-50 p-3 rounded-lg">
                  <div>
                    <a href={resolveUploadUrl(doc.fileUrl)} target="_blank" rel="noreferrer" className="font-medium text-primary-600 hover:underline">
                      {doc.name}
                    </a>
                    <p className="text-xs text-gray-500">{doc.type.replace("_", " ")} &bull; {formatDate(doc.createdAt)}</p>
                  </div>
                  {isAdmin && (
                    <button onClick={() => handleDeleteDocument(doc.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
              {(!staff.documents || staff.documents.length === 0) && (
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
            {staff.cardId ? (
              <div className="bg-green-50 text-green-700 text-sm font-mono p-3 rounded-lg">
                {staff.cardId}
              </div>
            ) : (
              <p className="text-sm text-gray-400">Not assigned</p>
            )}
          </div>

          {/* Status */}
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-600 mb-2">Status</h3>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${staff.isActive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
              {staff.isActive ? "Active" : "Left / Inactive"}
            </span>
          </div>
        </div>
      </div>

      <Modal isOpen={showEditModal} onClose={() => setShowEditModal(false)} title="Edit Staff" size="lg">
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
              <label className="block text-sm font-medium mb-1">Designation</label>
              <input className="input-field" value={editForm.designation} onChange={(e) => setEditForm({ ...editForm, designation: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Department</label>
              <input className="input-field" value={editForm.department} onChange={(e) => setEditForm({ ...editForm, department: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Type</label>
              <select className="input-field" value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}>
                <option value="TEACHING">Teaching</option>
                <option value="NON_TEACHING">Non-Teaching</option>
              </select>
            </div>
            {/* Point 10: shown whenever this staff record already has
                (or is being given) a custom label - "System Role"
                itself isn't editable here (see Add Staff form), but
                the free-text label always is. */}
            <div>
              <label className="block text-sm font-medium mb-1">Custom Staff Type (if &quot;Others&quot;)</label>
              <input
                className="input-field"
                placeholder="e.g., Lab Assistant"
                value={editForm.customStaffType}
                onChange={(e) => setEditForm({ ...editForm, customStaffType: e.target.value })}
              />
            </div>
            {/* Point 3a */}
            {editForm.type === "TEACHING" && (
              <div>
                <label className="block text-sm font-medium mb-1">Max Periods / Day</label>
                <input
                  type="number"
                  min={0}
                  className="input-field"
                  placeholder="0 = no limit"
                  value={editForm.maxPeriodsPerDay}
                  onChange={(e) => setEditForm({ ...editForm, maxPeriodsPerDay: e.target.value })}
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium mb-1">Qualification</label>
              <input className="input-field" value={editForm.qualification} onChange={(e) => setEditForm({ ...editForm, qualification: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Experience</label>
              <input className="input-field" value={editForm.experience} onChange={(e) => setEditForm({ ...editForm, experience: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">RFID Card ID</label>
              <input className="input-field" value={editForm.cardId} onChange={(e) => setEditForm({ ...editForm, cardId: e.target.value })} placeholder="Leave blank if none" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">PAN Number</label>
              <input className="input-field" value={editForm.panNumber} onChange={(e) => setEditForm({ ...editForm, panNumber: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Aadhar Number</label>
              <input className="input-field" value={editForm.aadharNumber} onChange={(e) => setEditForm({ ...editForm, aadharNumber: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Bank Account</label>
              <input className="input-field" value={editForm.bankAccount} onChange={(e) => setEditForm({ ...editForm, bankAccount: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Bank Name</label>
              <input className="input-field" value={editForm.bankName} onChange={(e) => setEditForm({ ...editForm, bankName: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">IFSC Code</label>
              <input className="input-field" value={editForm.ifscCode} onChange={(e) => setEditForm({ ...editForm, ifscCode: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Leaving Date</label>
              <input type="date" className="input-field" value={editForm.leavingDate} onChange={(e) => setEditForm({ ...editForm, leavingDate: e.target.value })} />
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
              This immediately replaces {staff.user.name}&apos;s login password with a new randomly-generated
              one-time password. Their current password (if any) will stop working right away.
            </p>
          </div>
          <p className="text-sm text-gray-600">
            The new password will be shown to you <span className="font-medium">once</span> - copy it and share it
            with the staff member. It cannot be retrieved again afterwards.
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
            Share this password with <span className="font-medium">{staff.user.name}</span> ({staff.user.email}) now.
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
            The staff member should change this password after logging in (Settings &gt; Change Password).
          </p>
          <div className="flex justify-end pt-4 border-t">
            <button type="button" onClick={() => setOneTimePassword(null)} className="btn-primary">I&apos;ve saved this - Close</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
