"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Trophy, Download } from "lucide-react";
import api from "@/lib/api";
import { openPdfInNewTab } from "@/lib/pdf";
import ErrorBanner from "@/components/ui/ErrorBanner";

export default function ExamResultsPage() {
  const params = useParams();
  const router = useRouter();
  const examId = params.id as string;

  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchResults = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.get(`/academics/exams/${examId}/results`);
      setResults(res.data.data || []);
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to load results");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchResults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId]);

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="p-2 rounded-lg hover:bg-gray-100">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Trophy className="h-6 w-6 text-primary-600" /> Exam Results
          </h1>
          <p className="text-gray-500 mt-1">Subject-wise marks, rank, and downloadable report cards</p>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchResults} />}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="px-4 py-3 text-left">Rank</th>
                <th className="px-4 py-3 text-left">Student</th>
                <th className="px-4 py-3 text-left">Total</th>
                <th className="px-4 py-3 text-left">Percentage</th>
                <th className="px-4 py-3 text-center">Report Card</th>
              </tr>
            </thead>
            <tbody>
              {results.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                    No results recorded for this exam yet.
                  </td>
                </tr>
              ) : (
                results.map((r) => (
                  <tr key={r.studentId} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">#{r.rank}</td>
                    <td className="px-4 py-3">{r.student}</td>
                    <td className="px-4 py-3">{r.total} / {r.maxTotal}</td>
                    <td className="px-4 py-3">
                      <span className={r.percentage >= 33 ? "text-green-700" : "text-red-700"}>
                        {r.percentage}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => openPdfInNewTab(`/academics/exams/${examId}/report-card/${r.studentId}`)}
                        className="inline-flex items-center gap-1 text-primary-600 text-xs font-medium hover:underline"
                      >
                        <Download className="h-3.5 w-3.5" /> Download
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
