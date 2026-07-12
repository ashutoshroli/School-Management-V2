"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Briefcase, MapPin, Calendar, CheckCircle2 } from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";
import { formatDate } from "@/lib/utils";

/**
 * Public, unauthenticated careers/job-listing page - lists open
 * JobVacancy postings (GET /public/jobs) and lets a visitor apply to
 * one via a modal form (POST /public/jobs/:id/apply). Mirrors the
 * "public submit, staff reviews" shape of the admission-inquiry page,
 * scoped to recruitment instead of student admissions.
 */
export default function PublicCareersPage() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [applyingTo, setApplyingTo] = useState<any>(null);
  const [form, setForm] = useState({ applicantName: "", email: "", phone: "", resumeUrl: "", coverNote: "" });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get("/public/jobs")
      .then((res) => setJobs(res.data.data || []))
      .catch(() => setJobs([]))
      .finally(() => setLoading(false));
  }, []);

  const openApply = (job: any) => {
    setApplyingTo(job);
    setForm({ applicantName: "", email: "", phone: "", resumeUrl: "", coverNote: "" });
    setSubmitted(false);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post(`/public/jobs/${applyingTo.id}/apply`, form);
      setSubmitted(true);
    } catch (err: any) {
      setError(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="max-w-3xl mx-auto">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6">
          <ArrowLeft className="h-4 w-4" /> Back to Home
        </Link>

        <div className="flex items-center gap-2 mb-6">
          <Briefcase className="h-7 w-7 text-primary-600" />
          <h1 className="text-xl font-bold text-gray-900">Careers</h1>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
          </div>
        ) : jobs.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-12">No open positions right now. Please check back later.</p>
        ) : (
          <div className="space-y-4">
            {jobs.map((job) => (
              <div key={job.id} className="card">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-semibold text-gray-900">{job.title}</h3>
                    {job.department && <p className="text-sm text-gray-500">{job.department}</p>}
                    <div className="flex items-center gap-4 text-xs text-gray-400 mt-2">
                      <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {job.branch?.name}{job.branch?.city ? `, ${job.branch.city}` : ""}</span>
                      {job.closingDate && <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> Apply by {formatDate(job.closingDate)}</span>}
                    </div>
                  </div>
                  <button onClick={() => openApply(job)} className="btn-primary text-sm flex-shrink-0">Apply</button>
                </div>
                <p className="text-sm text-gray-600 mt-3 whitespace-pre-line">{job.description}</p>
                {job.qualifications && (
                  <p className="text-xs text-gray-500 mt-2"><span className="font-medium">Qualifications:</span> {job.qualifications}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal isOpen={!!applyingTo} onClose={() => setApplyingTo(null)} title={applyingTo ? `Apply - ${applyingTo.title}` : "Apply"} size="md">
        {submitted ? (
          <div className="text-center py-6">
            <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" />
            <p className="font-semibold text-gray-900">Application Submitted!</p>
            <p className="text-sm text-gray-500 mt-1">We'll reach out if you're shortlisted.</p>
            <button onClick={() => setApplyingTo(null)} className="btn-secondary mt-5">Close</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>}
            <div>
              <label className="block text-sm font-medium mb-1">Full Name *</label>
              <input className="input-field" value={form.applicantName} onChange={(e) => setForm({ ...form, applicantName: e.target.value })} required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Email *</label>
                <input type="email" className="input-field" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Phone *</label>
                <input className="input-field" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Resume Link (Google Drive, etc.)</label>
              <input className="input-field" placeholder="https://..." value={form.resumeUrl} onChange={(e) => setForm({ ...form, resumeUrl: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Cover Note</label>
              <textarea className="input-field" rows={3} value={form.coverNote} onChange={(e) => setForm({ ...form, coverNote: e.target.value })} />
            </div>
            <div className="flex justify-end gap-3 pt-2 border-t">
              <button type="button" onClick={() => setApplyingTo(null)} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={submitting} className="btn-primary disabled:opacity-60">{submitting ? "Submitting..." : "Submit Application"}</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
