"use client";

import { useEffect, useState } from "react";
import { Settings as SettingsIcon, User, Lock, Building2, Loader2, Sparkles, CheckCircle2, AlertTriangle } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { resolveUploadUrl } from "@/lib/uploads";
import FileUploadButton from "@/components/ui/FileUploadButton";
import ErrorBanner from "@/components/ui/ErrorBanner";
import Modal from "@/components/ui/Modal";
import { formatDate } from "@/lib/utils";

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    </div>
  );
}
