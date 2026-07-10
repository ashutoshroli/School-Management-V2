"use client";

import { useEffect, useState } from "react";
import { BookOpen, CheckCircle2, Clock } from "lucide-react";
import api from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useChildren } from "@/hooks/useChildren";
import ChildSwitcher from "@/components/parent/ChildSwitcher";
import ErrorBanner from "@/components/ui/ErrorBanner";

export default function MyHomeworkPage() {
  const { user } = useAuth();
  const { children, selectedChildId, fetchChildren } = useChildren();
  const [homeworks, setHomeworks] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [content, setContent] = useState<Record<string, string>>({});

  const selectedChild = children.find((c) => c.id === selectedChildId);
  const isStudent = user?.role === "STUDENT";

  useEffect(() => {
    fetchChildren();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadHomework = async () => {
    if (!selectedChildId) return;
    setLoading(true);
    setError(null);
    try {
      const studentRes = await api.get(`/students/${selectedChildId}`);
      const { classId, sectionId } = studentRes.data.data;
      const res = await api.get("/academics/homework", { params: { classId, sectionId } });
      setHomeworks(res.data.data || []);
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to load homework");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedChildId) loadHomework();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChildId]);

  const handleSubmit = async (homeworkId: string) => {
    setSubmittingId(homeworkId);
    try {
      await api.post("/academics/homework/submit", { homeworkId, content: content[homeworkId] || "" });
      setSubmissions((prev) => ({ ...prev, [homeworkId]: true }));
      alert("Homework submitted!");
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to submit");
    } finally {
      setSubmittingId(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary-600" /> My Homework
          </h1>
          <p className="text-gray-500 mt-1">Assignments for {selectedChild?.user.name || "your child"}</p>
        </div>
        <ChildSwitcher />
      </div>

      {error && <ErrorBanner message={error} onRetry={loadHomework} />}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="space-y-3">
          {homeworks.map((h) => {
            // Note: `submissionCount` from the list endpoint is the total
            // across all students in the class, not specific to this
            // child - we only know "submitted by this child" once we've
            // submitted it ourselves in this session. A more complete
            // fix would have the backend return a per-student submitted
            // flag; tracked as a follow-up.
            const isDone = Boolean(submissions[h.id]);
            const overdue = new Date(h.dueDate) < new Date();
            return (
              <div key={h.id} className="card">
                <div className="flex items-start justify-between flex-wrap gap-3">
                  <div>
                    <h3 className="font-semibold text-gray-900">{h.title}</h3>
                    <p className="text-sm text-gray-500">{h.subject?.name}</p>
                    {h.description && <p className="text-sm text-gray-600 mt-2">{h.description}</p>}
                  </div>
                  <span className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full ${overdue && !isDone ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"}`}>
                    <Clock className="h-3.5 w-3.5" /> Due {formatDate(h.dueDate)}
                  </span>
                </div>

                {isStudent && (
                  <div className="mt-3 pt-3 border-t">
                    {isDone ? (
                      <span className="flex items-center gap-2 text-green-600 text-sm font-medium">
                        <CheckCircle2 className="h-4 w-4" /> Submitted
                      </span>
                    ) : (
                      <div className="flex gap-2">
                        <input
                          className="input-field flex-1"
                          placeholder="Add a note or link to your submission (optional)"
                          value={content[h.id] || ""}
                          onChange={(e) => setContent((prev) => ({ ...prev, [h.id]: e.target.value }))}
                        />
                        <button
                          onClick={() => handleSubmit(h.id)}
                          disabled={submittingId === h.id}
                          className="btn-primary text-sm disabled:opacity-60"
                        >
                          {submittingId === h.id ? "Submitting..." : "Mark as Done"}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {homeworks.length === 0 && (
            <p className="text-center text-gray-500 py-8">No homework assigned yet</p>
          )}
        </div>
      )}
    </div>
  );
}
