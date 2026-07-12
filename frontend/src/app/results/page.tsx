"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileSearch, Search, Loader2, AlertTriangle } from "lucide-react";
import api from "@/lib/api";

/**
 * Public, unauthenticated result-lookup page - a parent/student
 * verifies their identity with admissionNo + dateOfBirth (the closest
 * thing to a "registration number + DOB" pair the schema has) and
 * sees only PUBLISHED exam results (see
 * publicPortal.controller.ts's lookupPublicResults). Same "public
 * page, no dashboard layout, no auth" shape as
 * frontend/src/app/admission/page.tsx and
 * verify-certificate/[serialNo]/page.tsx.
 */
export default function PublicResultsPage() {
  const [admissionNo, setAdmissionNo] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await api.post("/public/results/lookup", { admissionNo, dateOfBirth });
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

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="max-w-2xl mx-auto">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6">
          <ArrowLeft className="h-4 w-4" /> Back to Home
        </Link>

        <div className="flex items-center gap-2 mb-6">
          <FileSearch className="h-7 w-7 text-primary-600" />
          <h1 className="text-xl font-bold text-gray-900">Check Exam Result</h1>
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
            {loading ? "Searching..." : "Check Result"}
          </button>
        </form>

        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-6">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" /> {error}
          </div>
        )}

        {result && (
          <div className="card space-y-5">
            <div className="border-b pb-3">
              <h2 className="font-semibold text-gray-900">{result.studentName}</h2>
              <p className="text-sm text-gray-500">
                {result.admissionNo} - {result.className} {result.sectionName} - {result.branchName}
              </p>
            </div>

            {result.results.length === 0 ? (
              <p className="text-sm text-gray-400">No published results are available yet.</p>
            ) : (
              result.results.map((r: any) => (
                <div key={r.examId} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-medium text-gray-900">{r.examName}</h3>
                    <span className="text-sm font-semibold text-primary-700">{r.percentage}%</span>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-500 border-b">
                        <th className="text-left py-1.5">Subject</th>
                        <th className="text-center py-1.5">Obtained</th>
                        <th className="text-center py-1.5">Max</th>
                        <th className="text-center py-1.5">Grade</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.subjects.map((s: any) => (
                        <tr key={s.subject} className="border-b last:border-0">
                          <td className="py-1.5">{s.subject}</td>
                          <td className="py-1.5 text-center">{s.obtained}</td>
                          <td className="py-1.5 text-center">{s.max}</td>
                          <td className="py-1.5 text-center font-medium">{s.grade || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="font-semibold border-t">
                        <td className="py-1.5">Total</td>
                        <td className="py-1.5 text-center">{r.total}</td>
                        <td className="py-1.5 text-center">{r.maxTotal}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
