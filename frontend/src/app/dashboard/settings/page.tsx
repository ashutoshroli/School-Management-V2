"use client";

import { useEffect, useState } from "react";
import { Settings as SettingsIcon, User, Lock, Building2, Loader2, Sparkles, CheckCircle2, AlertTriangle, DatabaseZap, Plus, Trash2, GraduationCap, Pencil, Clock, CalendarDays, SlidersHorizontal } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { resolveUploadUrl } from "@/lib/uploads";
import FileUploadButton from "@/components/ui/FileUploadButton";
import ErrorBanner from "@/components/ui/ErrorBanner";
import Modal from "@/components/ui/Modal";
import { formatDate } from "@/lib/utils";

interface DemoDataStatus {
  seeded: boolean;
  branchId: string | null;
  counts: {
    classes: number;
    sections: number;
    subjects: number;
    feeCategories: number;
    accounts: number;
    students: number;
    staff: number;
  };
  canRemove: boolean;
  blockedReasons: string[];
}

const RESULT_LABELS: Record<string, string> = {
  studentsCreated: "Students",
  parentsCreated: "Parents",
  staffCreated: "Staff",
  feeStructuresCreated: "Fee Structures",
  feeAssignmentsCreated: "Fee Assignments",
  paymentsCreated: "Payments Recorded",
  attendanceRecordsCreated: "Attendance Records",
  examsCreated: "Exams",
  marksCreated: "Marks Recorded",
  homeworkCreated: "Homework Assignments",
  noticesCreated: "Notices",
  transportRoutesCreated: "Transport Routes",
  transportAllocationsCreated: "Transport Allocations",
  libraryBooksCreated: "Library Books",
  libraryIssuesCreated: "Library Issues",
};

export default function SettingsPage() {
  const { user, setAuth, token } = useAuth();

  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [branch, setBranch] = useState<any>(null);
  const [branchLoading, setBranchLoading] = useState(false);

  const isAdmin = user?.role === "SUPER_ADMIN" || user?.role === "BRANCH_ADMIN";
  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  // Timetable/Exam clash-config access (spec Section 20) - PRINCIPAL/
  // VICE_PRINCIPAL are added alongside isAdmin here (not a replacement)
  // since the backend's own TIMETABLE_CREATORS role list for
  // GET/PUT /academics/timetable/config already includes them - this
  // just matches that on the frontend instead of hiding the panel from
  // the one role (Principal) the spec names as the timetable creator.
  const canConfigureTimetable = isAdmin || user?.role === "PRINCIPAL" || user?.role === "VICE_PRINCIPAL";

  // Structural "Demo Data" (Super Admin only) - creates/removes the
  // demo organization/branch/classes/subjects/fee categories/chart of
  // accounts/leave types/permissions entirely from the server, so a
  // trial deployment on a host with no Shell access (e.g. Render's
  // free tier) can be bootstrapped from this page alone - no local
  // machine or `npm run seed` required (see DEPLOY.md's Step 4, which
  // this UI is the in-app alternative to). This is the prerequisite
  // step before "Generate Demo Data" below, which fills an EXISTING
  // branch with realistic transactional records.
  const [demoStatus, setDemoStatus] = useState<DemoDataStatus | null>(null);
  const [demoStatusLoading, setDemoStatusLoading] = useState(false);
  const [demoActionLoading, setDemoActionLoading] = useState<"seed" | "remove" | null>(null);
  const [demoMessage, setDemoMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);

  const fetchDemoStatus = async () => {
    if (!isSuperAdmin) return;
    setDemoStatusLoading(true);
    try {
      const res = await api.get("/demo-data/status");
      setDemoStatus(res.data.data);
    } catch {
      setDemoStatus(null);
    } finally {
      setDemoStatusLoading(false);
    }
  };

  const handleAddDemoData = async () => {
    setDemoMessage(null);
    setDemoActionLoading("seed");
    try {
      const res = await api.post("/demo-data/seed");
      const summary = res.data.data;
      setDemoMessage({
        type: "success",
        text: `Demo data added: ${summary.classes} classes, ${summary.sections} sections, ${summary.subjects} subjects, ${summary.feeCategories} fee categories. Login as ${summary.superAdminEmail} / Admin@123 (Super Admin) or ${summary.branchAdminEmail} / Admin@123 (Branch Admin).`,
      });
      await fetchDemoStatus();
    } catch (err: any) {
      setDemoMessage({ type: "error", text: err.response?.data?.message || "Failed to add demo data" });
    } finally {
      setDemoActionLoading(null);
    }
  };

  const handleRemoveDemoData = async () => {
    setDemoMessage(null);
    setShowRemoveConfirm(false);
    setDemoActionLoading("remove");
    try {
      const res = await api.post("/demo-data/remove");
      setDemoMessage({ type: "success", text: res.data.message || "Demo data removed" });
      await fetchDemoStatus();
    } catch (err: any) {
      const reasons: string[] | undefined = (() => {
        try {
          return err.response?.data?.error ? JSON.parse(err.response.data.error) : undefined;
        } catch {
          return undefined;
        }
      })();
      const base = err.response?.data?.message || "Failed to remove demo data";
      setDemoMessage({ type: "error", text: reasons?.length ? `${base} Blocked by: ${reasons.join(", ")}.` : base });
    } finally {
      setDemoActionLoading(null);
    }
  };

  // Generate Demo Data - bulk-fills the current branch with realistic
  // students/staff/fees/attendance/exams/homework/notices/transport/
  // library data in one go, for demoing or testing every module at
  // once without hand-creating dozens of records first.
  const [showDemoDataConfirm, setShowDemoDataConfirm] = useState(false);
  const [demoDataForm, setDemoDataForm] = useState({
    studentsPerSection: "15",
    staffCount: "20",
    attendanceDays: "20",
    includeFeesAndPayments: true,
    includeAttendance: true,
    includeExamsAndMarks: true,
    includeHomeworkAndNotices: true,
    includeTransportAndLibrary: true,
  });
  const [generatingDemoData, setGeneratingDemoData] = useState(false);
  const [demoDataResult, setDemoDataResult] = useState<Record<string, number> | null>(null);
  const [demoDataError, setDemoDataError] = useState<string | null>(null);

  const handleGenerateDemoData = async () => {
    setGeneratingDemoData(true);
    setDemoDataError(null);
    try {
      const res = await api.post("/demo-data/generate", {
        studentsPerSection: parseInt(demoDataForm.studentsPerSection) || undefined,
        staffCount: parseInt(demoDataForm.staffCount) || undefined,
        attendanceDays: parseInt(demoDataForm.attendanceDays) || undefined,
        includeFeesAndPayments: demoDataForm.includeFeesAndPayments,
        includeAttendance: demoDataForm.includeAttendance,
        includeExamsAndMarks: demoDataForm.includeExamsAndMarks,
        includeHomeworkAndNotices: demoDataForm.includeHomeworkAndNotices,
        includeTransportAndLibrary: demoDataForm.includeTransportAndLibrary,
      });
      setShowDemoDataConfirm(false);
      setDemoDataResult(res.data.data);
    } catch (err: any) {
      setDemoDataError(err.response?.data?.message || "Failed to generate demo data");
    } finally {
      setGeneratingDemoData(false);
    }
  };

  // Grade System (grading scale bands, e.g. CBSE A1: 91-100, A2: 81-90,
  // ...) - system-wide, not branch-scoped (GradeSystem has no branchId
  // in the schema), so shown for any admin rather than gated on branch.
  // enterMarks (exam.controller.ts) auto-looks-up a grade from these
  // bands once at least one exists, falling back to the original
  // hardcoded A+/A/B+/.../F scale otherwise.
  const [gradeBands, setGradeBands] = useState<any[]>([]);
  const [gradeBandsLoading, setGradeBandsLoading] = useState(false);
  const [showGradeModal, setShowGradeModal] = useState(false);
  const [editingBand, setEditingBand] = useState<any>(null);
  const [gradeForm, setGradeForm] = useState({ name: "", minMarks: "", maxMarks: "", grade: "", gradePoint: "" });
  const [savingBand, setSavingBand] = useState(false);
  const [gradeError, setGradeError] = useState("");

  const fetchGradeBands = async () => {
    if (!isAdmin) return;
    setGradeBandsLoading(true);
    try {
      const res = await api.get("/academics/grade-system");
      setGradeBands(res.data.data || []);
    } catch {
      setGradeBands([]);
    } finally {
      setGradeBandsLoading(false);
    }
  };

  const openAddBand = () => {
    setEditingBand(null);
    setGradeForm({ name: "", minMarks: "", maxMarks: "", grade: "", gradePoint: "" });
    setGradeError("");
    setShowGradeModal(true);
  };

  const openEditBand = (b: any) => {
    setEditingBand(b);
    setGradeForm({ name: b.name, minMarks: String(b.minMarks), maxMarks: String(b.maxMarks), grade: b.grade, gradePoint: b.gradePoint !== null ? String(b.gradePoint) : "" });
    setGradeError("");
    setShowGradeModal(true);
  };

  const handleSaveBand = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingBand(true);
    setGradeError("");
    const payload: any = {
      name: gradeForm.name,
      minMarks: parseFloat(gradeForm.minMarks),
      maxMarks: parseFloat(gradeForm.maxMarks),
      grade: gradeForm.grade,
    };
    if (gradeForm.gradePoint) payload.gradePoint = parseFloat(gradeForm.gradePoint);
    try {
      if (editingBand) {
        await api.put(`/academics/grade-system/${editingBand.id}`, payload);
      } else {
        await api.post("/academics/grade-system", payload);
      }
      setShowGradeModal(false);
      await fetchGradeBands();
    } catch (err: any) {
      setGradeError(err.response?.data?.message || "Failed to save grade band");
    } finally {
      setSavingBand(false);
    }
  };

  const handleDeleteBand = async (b: any) => {
    if (!confirm(`Delete grade band "${b.grade}" (${b.minMarks}-${b.maxMarks})?`)) return;
    try {
      await api.delete(`/academics/grade-system/${b.id}`);
      fetchGradeBands();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to delete grade band");
    }
  };

  // Period Config (periods-per-day schedule used by the attendance
  // page's period picker, see PeriodConfig model doc comment) -
  // admins edit the whole list at once (add/remove rows, then Save),
  // matching upsertPeriodConfigs' "replace the whole branch list"
  // semantics rather than per-row CRUD.
  const [periods, setPeriods] = useState<any[]>([]);
  const [periodsLoading, setPeriodsLoading] = useState(false);
  const [savingPeriods, setSavingPeriods] = useState(false);
  const [periodsMessage, setPeriodsMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchPeriodConfigs = async () => {
    if (!isAdmin) return;
    setPeriodsLoading(true);
    try {
      const res = await api.get("/academics/period-config");
      const data = res.data.data || [];
      setPeriods(
        data.length > 0
          ? data.map((p: any) => ({ periodNo: p.periodNo, label: p.label || "", startTime: p.startTime, endTime: p.endTime, isBreak: p.isBreak }))
          : []
      );
    } catch {
      setPeriods([]);
    } finally {
      setPeriodsLoading(false);
    }
  };

  const addPeriodRow = () => {
    const nextNo = periods.length > 0 ? Math.max(...periods.map((p) => p.periodNo)) + 1 : 1;
    setPeriods([...periods, { periodNo: nextNo, label: "", startTime: "", endTime: "", isBreak: false }]);
  };

  const updatePeriodRow = (index: number, field: string, value: any) => {
    setPeriods(periods.map((p, i) => (i === index ? { ...p, [field]: value } : p)));
  };

  const removePeriodRow = (index: number) => {
    setPeriods(periods.filter((_, i) => i !== index));
  };

  const handleSavePeriods = async () => {
    setPeriodsMessage(null);
    if (periods.length === 0) {
      setPeriodsMessage({ type: "error", text: "Add at least one period before saving" });
      return;
    }
    for (const p of periods) {
      if (!p.startTime || !p.endTime) {
        setPeriodsMessage({ type: "error", text: "Every period needs a start and end time" });
        return;
      }
    }
    setSavingPeriods(true);
    try {
      const res = await api.put("/academics/period-config", { periods });
      const data = res.data.data || [];
      setPeriods(data.map((p: any) => ({ periodNo: p.periodNo, label: p.label || "", startTime: p.startTime, endTime: p.endTime, isBreak: p.isBreak })));
      setPeriodsMessage({ type: "success", text: "Period schedule saved" });
    } catch (err: any) {
      setPeriodsMessage({ type: "error", text: err.response?.data?.message || "Failed to save period schedule" });
    } finally {
      setSavingPeriods(false);
    }
  };

  // Timetable/Exam clash config (spec Section 20 - room/teacher clash
  // WARNING-vs-BLOCK, exam min-gap-days) + custom attendance week-
  // cycle length (spec Section 6) - branch-wide settings that
  // previously had a working backend endpoint (getTimetableConfig/
  // updateTimetableConfig) but NO frontend anywhere to view or change
  // them; every branch was stuck on whatever the schema's hardcoded
  // defaults were (room clash WARNING, teacher clash BLOCK, 0-day exam
  // gap, 7-day week cycle) with no way to configure otherwise short of
  // a raw API call.
  const [timetableConfig, setTimetableConfig] = useState<{
    roomClashMode: string; teacherClashMode: string; examMinGapDays: number; attendanceWeekCycleDays: number;
  } | null>(null);
  const [timetableConfigLoading, setTimetableConfigLoading] = useState(false);
  const [savingTimetableConfig, setSavingTimetableConfig] = useState(false);
  const [timetableConfigMessage, setTimetableConfigMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Uses the logged-in user's own JWT-derived branchId (see useAuth's
  // `user.branchId`) rather than the `branch` state above - `branch`
  // is only ever populated for isAdmin (fetchOwnBranch's own gate,
  // unchanged) via the ADMIN-only GET /branches endpoint, which would
  // 403 for a PRINCIPAL/VICE_PRINCIPAL. user.branchId is already
  // resolved into every role's JWT at login time (see auth.
  // controller.ts's login()), so it works for all of
  // canConfigureTimetable's roles without an extra branch-scoped call.
  const fetchTimetableConfig = async () => {
    if (!canConfigureTimetable || !user?.branchId) return;
    setTimetableConfigLoading(true);
    try {
      const res = await api.get(`/academics/timetable/config/${user.branchId}`);
      setTimetableConfig(res.data.data);
    } catch {
      setTimetableConfig(null);
    } finally {
      setTimetableConfigLoading(false);
    }
  };

  const handleSaveTimetableConfig = async () => {
    if (!timetableConfig || !user?.branchId) return;
    setTimetableConfigMessage(null);
    setSavingTimetableConfig(true);
    try {
      const res = await api.put(`/academics/timetable/config/${user.branchId}`, timetableConfig);
      setTimetableConfig(res.data.data);
      setTimetableConfigMessage({ type: "success", text: "Timetable/exam settings saved" });
    } catch (err: any) {
      setTimetableConfigMessage({ type: "error", text: err.response?.data?.message || "Failed to save settings" });
    } finally {
      setSavingTimetableConfig(false);
    }
  };

  // Holiday calendar (declared non-working days, see Holiday model doc
  // comment) - attendance reports exclude these from the "should have
  // been present" denominator.
  const [holidays, setHolidays] = useState<any[]>([]);
  const [holidaysLoading, setHolidaysLoading] = useState(false);
  const [holidayYear, setHolidayYear] = useState(new Date().getFullYear());
  const [showHolidayModal, setShowHolidayModal] = useState(false);
  const [holidayForm, setHolidayForm] = useState({ date: "", name: "" });
  const [savingHoliday, setSavingHoliday] = useState(false);
  const [holidayError, setHolidayError] = useState("");

  const fetchHolidays = async (year = holidayYear) => {
    if (!isAdmin) return;
    setHolidaysLoading(true);
    try {
      const res = await api.get("/hr/holidays", { params: { year } });
      setHolidays(res.data.data || []);
    } catch {
      setHolidays([]);
    } finally {
      setHolidaysLoading(false);
    }
  };

  const openAddHoliday = () => {
    setHolidayForm({ date: "", name: "" });
    setHolidayError("");
    setShowHolidayModal(true);
  };

  const handleSaveHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingHoliday(true);
    setHolidayError("");
    try {
      await api.post("/hr/holidays", holidayForm);
      setShowHolidayModal(false);
      await fetchHolidays();
    } catch (err: any) {
      setHolidayError(err.response?.data?.message || "Failed to add holiday");
    } finally {
      setSavingHoliday(false);
    }
  };

  const handleDeleteHoliday = async (h: any) => {
    if (!confirm(`Delete holiday "${h.name}" (${formatDate(h.date)})?`)) return;
    try {
      await api.delete(`/hr/holidays/${h.id}`);
      fetchHolidays();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to delete holiday");
    }
  };

  const fetchProfile = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/auth/profile");
      setProfile(res.data.data);
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to load profile");
    } finally {
      setLoading(false);
    }
  };

  const fetchOwnBranch = async () => {
    if (!isAdmin) return;
    setBranchLoading(true);
    try {
      // Branch Admins only ever have one branch (their own); Super
      // Admins land here without a specific branch selected, so this
      // section is just informational for them - full branch
      // management lives on the dedicated Branches page.
      const res = await api.get("/branches", { params: { limit: 1 } });
      setBranch(res.data.data?.[0] || null);
    } catch {
      setBranch(null);
    } finally {
      setBranchLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
    fetchOwnBranch();
    fetchDemoStatus();
    fetchGradeBands();
    fetchPeriodConfigs();
    fetchHolidays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchTimetableConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.branchId]);

  const handleAvatarUploaded = (data: any) => {
    if (user && token) {
      setAuth({ ...user, avatar: data.avatar }, token);
    }
    setProfile((prev: any) => (prev ? { ...prev, avatar: data.avatar } : prev));
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMessage(null);

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordMessage({ type: "error", text: "New password and confirmation do not match" });
      return;
    }

    setChangingPassword(true);
    try {
      await api.put("/auth/change-password", {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      setPasswordMessage({ type: "success", text: "Password changed successfully" });
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (err: any) {
      setPasswordMessage({ type: "error", text: err.response?.data?.message || "Failed to change password" });
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <SettingsIcon className="h-6 w-6 text-primary-600" /> Settings
        </h1>
        <p className="text-gray-500 mt-1">Manage your account and preferences</p>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchProfile} />}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="space-y-6 max-w-2xl">
          {/* Profile */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <User className="h-5 w-5 text-blue-600" /> Profile
            </h3>
            <div className="flex items-center gap-4 mb-5">
              <div className="w-16 h-16 rounded-full bg-primary-100 flex items-center justify-center overflow-hidden">
                {profile?.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={resolveUploadUrl(profile.avatar)} alt={profile.name} className="w-full h-full object-cover" />
                ) : (
                  <User className="h-7 w-7 text-primary-600" />
                )}
              </div>
              <FileUploadButton
                uploadPath="/auth/avatar"
                accept="image/jpeg,image/png,image/webp"
                label="Change Photo"
                onUploaded={handleAvatarUploaded}
              />
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-gray-500">Name</dt>
                <dd className="font-medium text-gray-900">{profile?.name}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Email</dt>
                <dd className="font-medium text-gray-900">{profile?.email}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Phone</dt>
                <dd className="font-medium text-gray-900">{profile?.phone || "-"}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Role</dt>
                <dd className="font-medium text-gray-900">{profile?.role?.replace(/_/g, " ")}</dd>
              </div>
              {profile?.lastLogin && (
                <div>
                  <dt className="text-gray-500">Last Login</dt>
                  <dd className="font-medium text-gray-900">{formatDate(profile.lastLogin)}</dd>
                </div>
              )}
            </dl>
            <p className="text-xs text-gray-400 mt-4">
              To update your name/phone, contact a branch administrator.
            </p>
          </div>

          {/* Change password */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Lock className="h-5 w-5 text-purple-600" /> Change Password
            </h3>
            {passwordMessage && (
              <div
                className={`mb-4 text-sm rounded-lg px-3 py-2 ${
                  passwordMessage.type === "success" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"
                }`}
              >
                {passwordMessage.text}
              </div>
            )}
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
                <input
                  type="password"
                  className="input-field"
                  value={passwordForm.currentPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                <input
                  type="password"
                  className="input-field"
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                  minLength={8}
                  required
                />
                <p className="text-xs text-gray-400 mt-1">At least 8 characters, with an uppercase letter and a number.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
                <input
                  type="password"
                  className="input-field"
                  value={passwordForm.confirmPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                  minLength={8}
                  required
                />
              </div>
              <button type="submit" disabled={changingPassword} className="btn-primary flex items-center gap-2 disabled:opacity-60">
                {changingPassword && <Loader2 className="h-4 w-4 animate-spin" />}
                {changingPassword ? "Updating..." : "Update Password"}
              </button>
            </form>
          </div>

          {/* Branch info (admins only) */}
          {isAdmin && (
            <div className="card">
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Building2 className="h-5 w-5 text-green-600" /> Branch
              </h3>
              {branchLoading ? (
                <div className="flex justify-center py-6">
                  <div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" />
                </div>
              ) : branch ? (
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-gray-500">Name</dt>
                    <dd className="font-medium text-gray-900">{branch.name}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Code</dt>
                    <dd className="font-medium text-gray-900">{branch.code}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">City</dt>
                    <dd className="font-medium text-gray-900">{branch.city || "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Status</dt>
                    <dd className="font-medium text-gray-900">{branch.isActive ? "Active" : "Inactive"}</dd>
                  </div>
                </dl>
              ) : (
                <p className="text-sm text-gray-400">No branch found.</p>
              )}
              <a href="/dashboard/branches" className="inline-block mt-4 text-sm font-medium text-primary-600 hover:underline">
                Manage branches &rarr;
              </a>
            </div>
          )}

          {/* Grade System (grading scale) management - admins only */}
          {isAdmin && (
            <div className="card">
              <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                <GraduationCap className="h-5 w-5 text-indigo-600" /> Grade System
              </h3>
              <p className="text-sm text-gray-500 mb-4">
                Configure the grading scale (e.g. CBSE A1: 91-100, A2: 81-90, ...) used to auto-assign a grade when
                marks are entered. If no bands are configured, the system falls back to a default A+/A/B+/B/C/D/E/F
                scale.
              </p>

              {gradeBandsLoading ? (
                <div className="flex justify-center py-6">
                  <div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" />
                </div>
              ) : (
                <div className="overflow-x-auto mb-4">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b bg-gray-50">
                      <th className="px-3 py-2 text-left">Name</th>
                      <th className="px-3 py-2 text-center">Range (%)</th>
                      <th className="px-3 py-2 text-center">Grade</th>
                      <th className="px-3 py-2 text-center">Grade Point</th>
                      <th className="px-3 py-2 text-center">Actions</th>
                    </tr></thead>
                    <tbody>
                      {gradeBands.map((b) => (
                        <tr key={b.id} className="border-b">
                          <td className="px-3 py-2">{b.name}</td>
                          <td className="px-3 py-2 text-center">{b.minMarks}-{b.maxMarks}</td>
                          <td className="px-3 py-2 text-center font-semibold text-primary-700">{b.grade}</td>
                          <td className="px-3 py-2 text-center">{b.gradePoint ?? "-"}</td>
                          <td className="px-3 py-2 text-center">
                            <div className="flex justify-center gap-2">
                              <button onClick={() => openEditBand(b)} className="text-primary-600 hover:text-primary-700" title="Edit"><Pencil className="h-4 w-4" /></button>
                              <button onClick={() => handleDeleteBand(b)} className="text-red-500 hover:text-red-700" title="Delete"><Trash2 className="h-4 w-4" /></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {gradeBands.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-400">No grade bands configured - using default scale</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}

              <button onClick={openAddBand} className="btn-secondary flex items-center gap-2 text-sm">
                <Plus className="h-4 w-4" /> Add Grade Band
              </button>
            </div>
          )}

          {/* Period Config (periods-per-day schedule) - admins only */}
          {isAdmin && (
            <div className="card">
              <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                <Clock className="h-5 w-5 text-cyan-600" /> Period Schedule
              </h3>
              <p className="text-sm text-gray-500 mb-4">
                Configure the periods-per-day schedule (start/end time, breaks) used by the attendance page&apos;s
                period picker and the timetable editor. Edit the whole list and click Save.
              </p>

              {periodsMessage && (
                <div
                  className={`mb-4 text-sm rounded-lg px-3 py-2 ${
                    periodsMessage.type === "success" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"
                  }`}
                >
                  {periodsMessage.text}
                </div>
              )}

              {periodsLoading ? (
                <div className="flex justify-center py-6">
                  <div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" />
                </div>
              ) : (
                <div className="overflow-x-auto mb-4">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b bg-gray-50">
                      <th className="px-3 py-2 text-left">#</th>
                      <th className="px-3 py-2 text-left">Label</th>
                      <th className="px-3 py-2 text-left">Start</th>
                      <th className="px-3 py-2 text-left">End</th>
                      <th className="px-3 py-2 text-center">Break?</th>
                      <th className="px-3 py-2 text-center">Actions</th>
                    </tr></thead>
                    <tbody>
                      {periods.map((p, i) => (
                        <tr key={i} className="border-b">
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min={1}
                              className="input-field w-16"
                              value={p.periodNo}
                              onChange={(e) => updatePeriodRow(i, "periodNo", parseInt(e.target.value) || 1)}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              className="input-field"
                              placeholder={`Period ${p.periodNo}`}
                              value={p.label}
                              onChange={(e) => updatePeriodRow(i, "label", e.target.value)}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="time"
                              className="input-field"
                              value={p.startTime}
                              onChange={(e) => updatePeriodRow(i, "startTime", e.target.value)}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="time"
                              className="input-field"
                              value={p.endTime}
                              onChange={(e) => updatePeriodRow(i, "endTime", e.target.value)}
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={p.isBreak}
                              onChange={(e) => updatePeriodRow(i, "isBreak", e.target.checked)}
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <button onClick={() => removePeriodRow(i)} className="text-red-500 hover:text-red-700" title="Remove">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {periods.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-center text-gray-400">No periods configured yet</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex gap-3">
                <button onClick={addPeriodRow} className="btn-secondary flex items-center gap-2 text-sm">
                  <Plus className="h-4 w-4" /> Add Period
                </button>
                <button onClick={handleSavePeriods} disabled={savingPeriods} className="btn-primary flex items-center gap-2 text-sm disabled:opacity-60">
                  {savingPeriods && <Loader2 className="h-4 w-4 animate-spin" />}
                  {savingPeriods ? "Saving..." : "Save Schedule"}
                </button>
              </div>
            </div>
          )}

          {/* Timetable/Exam clash config (spec Sections 6/20) - Admins
              plus Principal/Vice Principal (canConfigureTimetable),
              matching the backend's TIMETABLE_CREATORS role list for
              GET/PUT /academics/timetable/config/:branchId. */}
          {canConfigureTimetable && (
            <div className="card">
              <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                <SlidersHorizontal className="h-5 w-5 text-orange-600" /> Timetable &amp; Exam Settings
              </h3>
              <p className="text-sm text-gray-500 mb-4">
                Choose whether a room or teacher double-booking in the timetable should be blocked outright or only
                shown as a warning, set a minimum gap (in days) required between two exams for the same class, and
                customize the attendance week-cycle length.
              </p>

              {timetableConfigMessage && (
                <div
                  className={`mb-4 text-sm rounded-lg px-3 py-2 ${
                    timetableConfigMessage.type === "success" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"
                  }`}
                >
                  {timetableConfigMessage.text}
                </div>
              )}

              {timetableConfigLoading ? (
                <div className="flex justify-center py-6">
                  <div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" />
                </div>
              ) : !timetableConfig ? (
                <p className="text-sm text-gray-400">Unable to load timetable/exam settings.</p>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Room Clash Mode</label>
                      <select
                        className="input-field"
                        value={timetableConfig.roomClashMode}
                        onChange={(e) => setTimetableConfig({ ...timetableConfig, roomClashMode: e.target.value })}
                      >
                        <option value="WARNING">Warning only</option>
                        <option value="BLOCK">Block</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Teacher Clash Mode</label>
                      <select
                        className="input-field"
                        value={timetableConfig.teacherClashMode}
                        onChange={(e) => setTimetableConfig({ ...timetableConfig, teacherClashMode: e.target.value })}
                      >
                        <option value="WARNING">Warning only</option>
                        <option value="BLOCK">Block</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Min Gap Between Exams (days)</label>
                      <input
                        type="number"
                        min={0}
                        className="input-field"
                        value={timetableConfig.examMinGapDays}
                        onChange={(e) => setTimetableConfig({ ...timetableConfig, examMinGapDays: parseInt(e.target.value) || 0 })}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Attendance Week-Cycle (days)</label>
                      <input
                        type="number"
                        min={1}
                        className="input-field"
                        value={timetableConfig.attendanceWeekCycleDays}
                        onChange={(e) => setTimetableConfig({ ...timetableConfig, attendanceWeekCycleDays: parseInt(e.target.value) || 1 })}
                      />
                    </div>
                  </div>

                  <button
                    onClick={handleSaveTimetableConfig}
                    disabled={savingTimetableConfig}
                    className="btn-primary flex items-center gap-2 text-sm disabled:opacity-60"
                  >
                    {savingTimetableConfig && <Loader2 className="h-4 w-4 animate-spin" />}
                    {savingTimetableConfig ? "Saving..." : "Save Settings"}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Holiday calendar (declared non-working days) - admins only */}
          {isAdmin && (
            <div className="card">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <CalendarDays className="h-5 w-5 text-rose-600" /> Holiday Calendar
                </h3>
                <select
                  className="input-field w-auto"
                  value={holidayYear}
                  onChange={(e) => {
                    const y = parseInt(e.target.value);
                    setHolidayYear(y);
                    fetchHolidays(y);
                  }}
                >
                  {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 1 + i).map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
              <p className="text-sm text-gray-500 mb-4">
                Declared non-working days for this branch. Staff attendance reports exclude these dates so absence
                isn&apos;t wrongly implied on a day nobody was expected in.
              </p>

              {holidaysLoading ? (
                <div className="flex justify-center py-6">
                  <div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" />
                </div>
              ) : (
                <div className="overflow-x-auto mb-4">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b bg-gray-50">
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-left">Name</th>
                      <th className="px-3 py-2 text-center">Actions</th>
                    </tr></thead>
                    <tbody>
                      {holidays.map((h) => (
                        <tr key={h.id} className="border-b">
                          <td className="px-3 py-2">{formatDate(h.date)}</td>
                          <td className="px-3 py-2">{h.name}</td>
                          <td className="px-3 py-2 text-center">
                            <button onClick={() => handleDeleteHoliday(h)} className="text-red-500 hover:text-red-700" title="Delete">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {holidays.length === 0 && <tr><td colSpan={3} className="px-3 py-4 text-center text-gray-400">No holidays declared for {holidayYear}</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}

              <button onClick={openAddHoliday} className="btn-secondary flex items-center gap-2 text-sm">
                <Plus className="h-4 w-4" /> Add Holiday
              </button>
            </div>
          )}

          {/* Structural Demo Data seed/remove (Super Admin only) - the
              prerequisite step before "Generate Demo Data" below can
              be used on a brand-new/empty deployment. */}
          {isSuperAdmin && (
            <div className="card">
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <DatabaseZap className="h-5 w-5 text-amber-600" /> Demo Data
              </h3>
              <p className="text-sm text-gray-500 mb-4">
                Add a ready-made demo organization, branch, classes, subjects, fee categories and chart of accounts -
                the starting structure a brand-new/empty deployment needs before you can use &quot;Generate Demo
                Data&quot; below. Runs entirely on the server, no local machine or Shell access needed.
              </p>

              {demoMessage && (
                <div
                  className={`mb-4 text-sm rounded-lg px-3 py-2 ${
                    demoMessage.type === "success" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"
                  }`}
                >
                  {demoMessage.text}
                </div>
              )}

              {demoStatusLoading ? (
                <div className="flex justify-center py-6">
                  <div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" />
                </div>
              ) : demoStatus?.seeded ? (
                <>
                  <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm mb-4">
                    <div>
                      <dt className="text-gray-500">Classes</dt>
                      <dd className="font-medium text-gray-900">{demoStatus.counts.classes}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Sections</dt>
                      <dd className="font-medium text-gray-900">{demoStatus.counts.sections}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Subjects</dt>
                      <dd className="font-medium text-gray-900">{demoStatus.counts.subjects}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Students</dt>
                      <dd className="font-medium text-gray-900">{demoStatus.counts.students}</dd>
                    </div>
                  </dl>

                  {!demoStatus.canRemove && demoStatus.blockedReasons.length > 0 && (
                    <div className="mb-4 text-sm rounded-lg px-3 py-2 bg-amber-50 text-amber-800 border border-amber-200 flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      <span>
                        Cannot remove - real data exists on top of the demo branch: {demoStatus.blockedReasons.join(", ")}.
                        Remove/reassign those first, or keep the demo data.
                      </span>
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button
                      onClick={handleAddDemoData}
                      disabled={demoActionLoading !== null}
                      className="btn-secondary flex items-center gap-2 disabled:opacity-60"
                    >
                      {demoActionLoading === "seed" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      Re-sync Demo Data
                    </button>
                    <button
                      onClick={() => setShowRemoveConfirm(true)}
                      disabled={demoActionLoading !== null || !demoStatus.canRemove}
                      className="px-4 py-2 rounded-lg text-sm font-medium text-red-600 border border-red-200 hover:bg-red-50 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {demoActionLoading === "remove" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      Remove Demo Data
                    </button>
                  </div>
                </>
              ) : (
                <button
                  onClick={handleAddDemoData}
                  disabled={demoActionLoading !== null}
                  className="btn-primary flex items-center gap-2 disabled:opacity-60"
                >
                  {demoActionLoading === "seed" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  {demoActionLoading === "seed" ? "Adding..." : "Add Demo Data"}
                </button>
              )}

              {/* Remove confirmation */}
              {showRemoveConfirm && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowRemoveConfirm(false)}>
                  <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
                    <h4 className="text-lg font-semibold text-gray-900 mb-2 flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-red-500" /> Remove Demo Data?
                    </h4>
                    <p className="text-sm text-gray-600 mb-5">
                      This permanently deletes the demo organization, branch, classes, sections, subjects, fee categories,
                      chart of accounts, and the demo Branch Admin login. This cannot be undone.
                    </p>
                    <div className="flex justify-end gap-3">
                      <button onClick={() => setShowRemoveConfirm(false)} className="btn-secondary">Cancel</button>
                      <button onClick={handleRemoveDemoData} className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700">
                        Yes, Remove It
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Generate Demo Data (admins only) */}
          {isAdmin && (
            <div className="card">
              <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-amber-500" /> Generate Demo Data
              </h3>
              <p className="text-sm text-gray-500 mb-4">
                Bulk-fills your branch ({branch?.name || "current branch"}) with realistic students, parents, staff,
                fee assignments &amp; payments, attendance, exams &amp; marks, homework, notices, transport, and
                library records - useful for demoing or testing every module at once. Safe to re-run; it won&apos;t
                duplicate students already added to a section beyond the target count.
              </p>

              {demoDataError && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 mb-4">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" /> {demoDataError}
                </div>
              )}

              {demoDataResult && (
                <div className="mb-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-green-700 mb-2">
                    <CheckCircle2 className="h-4 w-4" /> Demo data generated successfully
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
                    {Object.entries(demoDataResult)
                      .filter(([, v]) => v > 0)
                      .map(([key, value]) => (
                        <div key={key} className="bg-gray-50 rounded-lg px-3 py-2">
                          <span className="font-semibold text-gray-900">{value}</span>{" "}
                          <span className="text-gray-500">{RESULT_LABELS[key] || key}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              <button onClick={() => setShowDemoDataConfirm(true)} className="btn-secondary flex items-center gap-2">
                <Sparkles className="h-4 w-4" /> Generate Demo Data
              </button>
            </div>
          )}
        </div>
      )}

      <Modal isOpen={showDemoDataConfirm} onClose={() => setShowDemoDataConfirm(false)} title="Generate Demo Data" size="md">
        <div className="space-y-4">
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-3 py-2">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            This creates real records in {branch?.name || "your branch"} (visible everywhere - Students, Staff,
            Fees, Attendance, Exams, etc). It cannot be undone in bulk; remove records individually if needed
            afterwards.
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Students / Section</label>
              <input
                type="number"
                min={1}
                max={40}
                className="input-field"
                value={demoDataForm.studentsPerSection}
                onChange={(e) => setDemoDataForm({ ...demoDataForm, studentsPerSection: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Staff Count</label>
              <input
                type="number"
                min={1}
                max={100}
                className="input-field"
                value={demoDataForm.staffCount}
                onChange={(e) => setDemoDataForm({ ...demoDataForm, staffCount: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Attendance Days</label>
              <input
                type="number"
                min={1}
                max={60}
                className="input-field"
                value={demoDataForm.attendanceDays}
                onChange={(e) => setDemoDataForm({ ...demoDataForm, attendanceDays: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-700">Include:</p>
            {[
              { key: "includeFeesAndPayments", label: "Fee structures, assignments & payments" },
              { key: "includeAttendance", label: "Student & staff attendance" },
              { key: "includeExamsAndMarks", label: "Exams & marks" },
              { key: "includeHomeworkAndNotices", label: "Homework & notices" },
              { key: "includeTransportAndLibrary", label: "Transport routes & library issues" },
            ].map((opt) => (
              <label key={opt.key} className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={(demoDataForm as any)[opt.key]}
                  onChange={(e) => setDemoDataForm({ ...demoDataForm, [opt.key]: e.target.checked })}
                />
                {opt.label}
              </label>
            ))}
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setShowDemoDataConfirm(false)} className="btn-secondary">Cancel</button>
            <button
              type="button"
              onClick={handleGenerateDemoData}
              disabled={generatingDemoData}
              className="btn-primary flex items-center gap-2 disabled:opacity-60"
            >
              {generatingDemoData && <Loader2 className="h-4 w-4 animate-spin" />}
              {generatingDemoData ? "Generating... this may take a minute" : "Generate"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showGradeModal} onClose={() => setShowGradeModal(false)} title={editingBand ? "Edit Grade Band" : "Add Grade Band"} size="md">
        <form onSubmit={handleSaveBand} className="space-y-4">
          {gradeError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{gradeError}</div>}
          <div>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input className="input-field" value={gradeForm.name} onChange={(e) => setGradeForm({ ...gradeForm, name: e.target.value })} placeholder="e.g. CBSE Grading" required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Min Marks (%) *</label>
              <input type="number" min={0} max={100} step="0.01" className="input-field" value={gradeForm.minMarks} onChange={(e) => setGradeForm({ ...gradeForm, minMarks: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Max Marks (%) *</label>
              <input type="number" min={0} max={100} step="0.01" className="input-field" value={gradeForm.maxMarks} onChange={(e) => setGradeForm({ ...gradeForm, maxMarks: e.target.value })} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Grade *</label>
              <input className="input-field" value={gradeForm.grade} onChange={(e) => setGradeForm({ ...gradeForm, grade: e.target.value })} placeholder="e.g. A1" required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Grade Point</label>
              <input type="number" min={0} step="0.1" className="input-field" value={gradeForm.gradePoint} onChange={(e) => setGradeForm({ ...gradeForm, gradePoint: e.target.value })} placeholder="e.g. 10" />
            </div>
          </div>
          <p className="text-xs text-gray-400">The range must not overlap any other configured band.</p>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowGradeModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={savingBand} className="btn-primary disabled:opacity-50">
              {savingBand ? "Saving..." : editingBand ? "Save Changes" : "Create"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={showHolidayModal} onClose={() => setShowHolidayModal(false)} title="Add Holiday" size="sm">
        <form onSubmit={handleSaveHoliday} className="space-y-4">
          {holidayError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{holidayError}</div>}
          <div>
            <label className="block text-sm font-medium mb-1">Date *</label>
            <input
              type="date"
              className="input-field"
              value={holidayForm.date}
              onChange={(e) => setHolidayForm({ ...holidayForm, date: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input
              className="input-field"
              value={holidayForm.name}
              onChange={(e) => setHolidayForm({ ...holidayForm, name: e.target.value })}
              placeholder="e.g. Diwali"
              required
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowHolidayModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={savingHoliday} className="btn-primary disabled:opacity-50">
              {savingHoliday ? "Saving..." : "Add Holiday"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
