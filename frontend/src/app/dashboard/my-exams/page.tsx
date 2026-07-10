"use client";

import { useEffect, useState } from "react";
import { FileText, Download } from "lucide-react";
import api from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { openPdfInNewTab } from "@/lib/pdf";
import { useChildren } from "@/hooks/useChildren";
import ChildSwitcher from "@/components/parent/ChildSwitcher";
import ErrorBanner from "@/components/ui/ErrorBanner";

export default function MyExamsPage() {
  const { children, selectedChildId, fetchChildren } = useChildren();
  const [exams, setExams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectedChild = children.find((c) => c.id === selectedChildId);

  useEffect(() => {
    fetchChildren();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadExams = async () => {
    if (!selectedChildId) return;
    setLoading(true);
    setError(null);
    try {
      const studentRes = await api.get(`/students/${selectedChildId}`);
      const { classId } = studentRes.data.data;
      const res = await api.get("/academics/exams", { params: { classId } });
      // Only show exams whose results have been published - unpublished
      // results are intentionally hidden from students/parents (the
      // report-card PDF endpoint enforces this server-side too).
      setExams((res.data.data || []).filter((e: any) => e.isPublished));
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to load exams");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedChildId) loadExams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChildId]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary-600" /> My Exams &amp; Results
          </h1>
          <p className="text-gray-500 mt-1">Published exam results for {selectedChild?.user.name || "your child"}</p>
        </div>
        <ChildSwitcher />
      </div>

      {error && <ErrorBanner message={error} onRetry={loadExams} />}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="space-y-3">
          {exams.map((e) => (
            <div key={e.id} className="card flex items-center justify-between flex-wrap gap-3">
              <div>
                <h3 className="font-semibold text-gray-900">{e.name}</h3>
                <p className="text-sm text-gray-500">
                  {e.type.replace(/_/g, " ")} &bull; {e.academicYear?.name}
                  {e.startDate && <> &bull; {formatDate(e.startDate)}</>}
                </p>
              </div>
              <button
                onClick={() => openPdfInNewTab(`/academics/exams/${e.id}/report-card/${selectedChildId}`)}
                className="btn-secondary flex items-center gap-2 text-sm"
              >
                <Download className="h-4 w-4" /> Download Report Card
              </button>
            </div>
          ))}
          {exams.length === 0 && (
            <p className="text-center text-gray-500 py-8">No published results yet</p>
          )}
        </div>
      )}
    </div>
  );
}
