"use client";

import { useEffect, useState } from "react";
import { GraduationCap, CheckCircle2 } from "lucide-react";
import api from "@/lib/api";

interface BranchOption {
  id: string;
  name: string;
  city?: string;
}

const initialForm = {
  branchId: "",
  studentName: "",
  dateOfBirth: "",
  gender: "MALE",
  classAppliedFor: "",
  parentName: "",
  parentEmail: "",
  parentPhone: "",
  address: "",
  previousSchool: "",
  message: "",
};

/**
 * Public, unauthenticated "Apply for Admission" page - intentionally
 * outside the /dashboard tree (no login required, no Sidebar/Header).
 * Submits to POST /api/admission/inquiries, which only records an
 * inquiry for staff follow-up (see admission.controller.ts) - it does
 * NOT create a login-capable account, so there's no security concern
 * in leaving this endpoint open to anonymous visitors.
 */
export default function PublicAdmissionPage() {
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get("/admission/branches")
      .then((res) => setBranches(res.data.data || []))
      .catch(() => setBranches([]));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/admission/inquiries", form);
      setSubmitted(true);
    } catch (err: any) {
      setError(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-blue-100 px-4">
        <div className="max-w-md w-full text-center card">
          <CheckCircle2 className="h-14 w-14 text-green-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Inquiry Submitted!</h1>
          <p className="text-gray-600">
            Thank you for your interest. Our admissions team will reach out to you shortly at the contact details you provided.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-blue-100 px-4 py-10">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-600 rounded-2xl mb-4">
            <GraduationCap className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Apply for Admission</h1>
          <p className="text-gray-500 mt-1">Fill in the details below and our team will get in touch with you</p>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-5">
          {error && (
            <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg border border-red-200">{error}</div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Branch / Campus *</label>
            <select
              className="input-field"
              value={form.branchId}
              onChange={(e) => setForm({ ...form, branchId: e.target.value })}
              required
            >
              <option value="">Select a branch</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} {b.city ? `- ${b.city}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Student Name *</label>
              <input className="input-field" value={form.studentName} onChange={(e) => setForm({ ...form, studentName: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Class Applying For *</label>
              <input className="input-field" placeholder="e.g. Class 5" value={form.classAppliedFor} onChange={(e) => setForm({ ...form, classAppliedFor: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date of Birth *</label>
              <input type="date" className="input-field" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Gender *</label>
              <select className="input-field" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
          </div>

          <div className="border-t pt-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Parent / Guardian Details</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
                <input className="input-field" value={form.parentName} onChange={(e) => setForm({ ...form, parentName: e.target.value })} required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone *</label>
                <input className="input-field" value={form.parentPhone} onChange={(e) => setForm({ ...form, parentPhone: e.target.value })} required />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                <input type="email" className="input-field" value={form.parentEmail} onChange={(e) => setForm({ ...form, parentEmail: e.target.value })} required />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
            <input className="input-field" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Previous School (if any)</label>
            <input className="input-field" value={form.previousSchool} onChange={(e) => setForm({ ...form, previousSchool: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Message / Questions</label>
            <textarea className="input-field" rows={3} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
          </div>

          <button type="submit" disabled={submitting} className="btn-primary w-full py-2.5">
            {submitting ? "Submitting..." : "Submit Inquiry"}
          </button>
        </form>
      </div>
    </div>
  );
}
