"use client";
import { useState } from "react";
import Link from "next/link";
import api from "@/lib/api";
import { Mail, ArrowLeft, CheckCircle } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api.post("/auth/forgot-password", { email });
      setSent(true);
    } catch (err: any) {
      setError(err.response?.data?.message || "Something went wrong.");
    } finally { setLoading(false); }
  };

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full text-center">
          <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
            <CheckCircle className="h-8 w-8 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Check your email</h1>
          <p className="text-gray-600 mb-6">If an account exists with <strong>{email}</strong>, we sent a reset link.</p>
          <Link href="/auth/login" className="text-primary-600 hover:text-primary-700 font-medium">Back to login</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full">
        <Link href="/auth/login" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-6">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to login
        </Link>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <div className="text-center mb-6">
            <div className="mx-auto w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center mb-3">
              <Mail className="h-6 w-6 text-primary-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Forgot password?</h1>
            <p className="text-gray-500 text-sm mt-1">Enter your email and we will send a reset link.</p>
          </div>
          {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">Email address</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@school.edu" className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" />
            </div>
            <button type="submit" disabled={loading || !email} className="w-full py-2.5 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:opacity-50">
              {loading ? "Sending..." : "Send reset link"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
