"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ClipboardList, Save } from "lucide-react";
import api from "@/lib/api";
import ErrorBanner from "@/components/ui/ErrorBanner";

interface StudentRow {
  studentId: string;
  name: string;
  admissionNo: string;
  maxMarks: string;
  obtainedMarks: string;
}

export default function EnterMarksPage() {
  const params = useParams();
  const router = useRouter();
  const examId = params.id as string;

  const [exam, setExam] = useState<any>(null);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [rows, setRows] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the exam's own metadata (no single-exam GET endpoint exists,
  // so pull it out of the list the Exams page already uses) plus the
  // subjects taught in that exam's class.
  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        // BUG FIX: was fetching the entire exam list and finding this
        // exam client-side (fragile + slow) - getExamById is
        // branch-scoped and fetches exactly this one exam directly.
        const examRes = await api.get(`/academics/exams/${examId}`);
        const found = examRes.data.data;
        if (!found) {
          setError("Exam not found");
          return;
        }
        setExam(found);

        const subjectsRes = await api.get(`/classes/${found.classId}/subjects`);
        const subjectList = (subjectsRes.data.data || []).map((cs: any) => cs.subject);
        setSubjects(subjectList);
        if (subjectList.length > 0) setSubjectId(subjectList[0].id);
      } catch (err: any) {
        setError(err.response?.data?.message || "Failed to load exam");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [examId]);

  // Load the class roster + any marks already recorded for this
  // subject, whenever the exam or the selected subject changes.
  useEffect(() => {
    const loadRoster = async () => {
      if (!exam || !subjectId) return;
      try {
        const [studentsRes, resultsRes] = await Promise.all([
          api.get("/students", { params: { classId: exam.classId, limit: 200 } }),
          api.get(`/academics/exams/${examId}/results`),
        ]);
        const students = studentsRes.data.data || [];
        const results = resultsRes.data.data || [];

        setRows(
          students.map((s: any) => {
            const existingResult = results.find((r: any) => r.studentId === s.id);
            const existingSubjectMark = existingResult?.subjects?.find((sub: any) => sub.subject === subjects.find((sj) => sj.id === subjectId)?.name);
            return {
              studentId: s.id,
              name: s.user.name,
              admissionNo: s.admissionNo,
              maxMarks: existingSubjectMark ? String(existingSubjectMark.max) : "100",
              obtainedMarks: existingSubjectMark ? String(existingSubjectMark.obtained) : "",
            };
          })
        );
      } catch {
        // Roster load failure isn't fatal - an empty table with a
        // retry-by-reselecting-subject is acceptable here.
      }
    };
    loadRoster();
  }, [exam, subjectId, examId, subjects]);

  const updateRow = (studentId: string, field: "maxMarks" | "obtainedMarks", value: string) => {
    setRows((prev) => prev.map((r) => (r.studentId === studentId ? { ...r, [field]: value } : r)));
  };

  const handleSave = async () => {
    if (!subjectId) return;
    const marks = rows
      .filter((r) => r.obtainedMarks.trim() !== "")
      .map((r) => ({
        studentId: r.studentId,
        maxMarks: parseFloat(r.maxMarks) || 100,
        obtainedMarks: parseFloat(r.obtainedMarks),
      }));

    if (marks.length === 0) {
      alert("Enter at least one student's marks before saving");
      return;
    }

    setSaving(true);
    try {
      const res = await api.post("/academics/exams/marks", { examId, subjectId, marks });
      alert(res.data.message);
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to save marks");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="p-2 rounded-lg hover:bg-gray-100">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ClipboardList className="h-6 w-6 text-primary-600" /> Enter Marks
          </h1>
          <p className="text-gray-500 mt-1">{exam ? `${exam.name} - ${exam.class?.name}` : "Loading exam..."}</p>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={() => router.refresh()} />}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
        </div>
      ) : exam ? (
        <>
          <div className="card mb-4 flex items-center gap-4">
            <label className="text-sm font-medium text-gray-700">Subject</label>
            <select className="input-field w-auto" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              {subjects.length === 0 && <option value="">No subjects configured for this class</option>}
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="px-4 py-3 text-left">Admission No</th>
                  <th className="px-4 py-3 text-left">Student</th>
                  <th className="px-4 py-3 text-center">Max Marks</th>
                  <th className="px-4 py-3 text-center">Obtained Marks</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.studentId} className="border-b">
                    <td className="px-4 py-3 text-xs text-gray-500">{r.admissionNo}</td>
                    <td className="px-4 py-3 font-medium">{r.name}</td>
                    <td className="px-4 py-3 text-center">
                      <input
                        type="number"
                        className="input-field w-20 text-center mx-auto"
                        value={r.maxMarks}
                        onChange={(e) => updateRow(r.studentId, "maxMarks", e.target.value)}
                      />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <input
                        type="number"
                        className="input-field w-20 text-center mx-auto"
                        value={r.obtainedMarks}
                        onChange={(e) => updateRow(r.studentId, "obtainedMarks", e.target.value)}
                      />
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500">No students found in this class</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {rows.length > 0 && (
            <div className="flex justify-end mt-4">
              <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-50">
                <Save className="h-4 w-4" /> {saving ? "Saving..." : "Save Marks"}
              </button>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
