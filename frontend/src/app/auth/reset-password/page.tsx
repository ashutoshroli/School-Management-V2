"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import api from "@/lib/api";
import { Lock, CheckCircle, AlertTriangle } from "lucide-react";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full text-center">
          <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4"><AlertTriangle className="h-8 w-8 text-red-600" /></div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Invalid link</h1>
          <p className="text-gray-600 mb-6">This password reset link is invalid or missing the token.</p>
          <Link href="/auth/forgot-password" className="text-primary-600 hover:text-primary-700 font-medium">Request a new link</Link>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) { setError("Passwords do not match"); return; }
    setLoading(true);
    try {
      await api.post("/auth/reset-password", { token, newPassword: password });
      setSuccess(true);
    } catch (err: any) { setError(err.response?.data?.message || "Failed to reset password."); }
    finally { setLoading(false); }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full text-center">
          <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4"><CheckCircle className="h-8 w-8 text-green-600" /></div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Password reset!</h1>
          <p className="text-gray-600 mb-6">You can now log in with your new password.</p>
          <Link href="/auth/login" className="inline-block py-2.5 px-6 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700">Go to login</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <div className="text-center mb-6">
            <div className="mx-auto w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center mb-3"><Lock className="h-6 w-6 text-primary-600" /></div>
            <h1 className="text-2xl font-bold text-gray-900">Set new password</h1>
          </div>
          {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">New password</label>
              <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" />
            </div>
            <div>
              <label htmlFor="confirm" className="block text-sm font-medium text-gray-700 mb-1">Confirm password</label>
              <input id="confirm" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" />
            </div>
            <button type="submit" disabled={loading || !password || !confirmPassword} className="w-full py-2.5 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 disabled:opacity-50">
              {loading ? "Resetting..." : "Reset password"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>}>
      <ResetPasswordForm />
    </Suspense>
  );
}
