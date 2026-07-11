"use client";

import { useState, useEffect } from "react";
import { ArrowUpCircle, CheckCircle2, AlertTriangle } from "lucide-react";
import api from "@/lib/api";

interface ClassItem {
  id: string;
  name: string;
  numericOrder: number;
  sections: { id: string; name: string }[];
}

interface StudentRow {
  id: string;
  admissionNo: string;
  rollNo: string | null;
  user: { name: string };
}

/**
 * Year-end student promotion - the counterpart to bulkAssignFees/
 * bulkAssignSalaryStructure's "pick a scope, apply one action to
 * everyone in it" pattern, but with a per-student override (detain /
 * issue TC) instead of a uniform template, since promotion outcome is
 * inherently per-student.
 *
 * Flow: pick source class (+ optional section) -> pick target class +
 * target section -> review the student list, marking any student as
 * Detained or TC Issued (default: everyone else is Promoted) -> confirm.
 */
export default function PromotionPage() {
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [years, setYears] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [fromClassId, setFromClassId] = useState("");
  const [fromSectionId, setFromSectionId] = useState("");
  const [toClassId, setToClassId] = useState("");
  const [toSectionId, setToSectionId] = useState("");
  const [academicYearId, setAcademicYearId] = useState("");

  const [students, setStudents] = useState<StudentRow[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [detained, setDetained] = useState<Set<string>>(new Set());
  const [tcIssued, setTcIssued] = useState<Set<string>>(new Set());

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ promoted: number; detained: number; tcIssued: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [cRes, yRes] = await Promise.all([api.get("/classes"), api.get("/academic-years")]);
        const cls: ClassItem[] = cRes.data.data || [];
        setClasses(cls);
        const yearsData = yRes.data.data || [];
        setYears(yearsData);
        const activeYear = yearsData.find((y: any) => y.isActive);
        if (activeYear) setAcademicYearId(activeYear.id);
      } catch {
        setError("Failed to load classes/academic years");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Fetch the source class/section's active student list whenever the
  // scope changes - this drives the review table below.
  useEffect(() => {
    if (!fromClassId) { setStudents([]); return; }
    setStudentsLoading(true);
    setDetained(new Set());
    setTcIssued(new Set());
    setResult(null);
    api
      .get("/students", { params: { classId: fromClassId, sectionId: fromSectionId || undefined, limit: 500 } })
      .then((res) => setStudents(res.data.data || []))
      .catch(() => setStudents([]))
      .finally(() => setStudentsLoading(false));
  }, [fromClassId, fromSectionId]);

  const fromClass = classes.find((c) => c.id === fromClassId);
  const toClass = classes.find((c) => c.id === toClassId);
  // Suggests the numerically-next class as a starting point once a
  // source class is picked - pure UX convenience, the admin can still
  // override it via the dropdown.
  useEffect(() => {
    if (!fromClass) return;
    const next = classes.find((c) => c.numericOrder === fromClass.numericOrder + 1);
    if (next) setToClassId((prev) => prev || next.id);
  }, [fromClass, classes]);

  const toggleSet = (set: Set<string>, setSet: (s: Set<string>) => void, id: string, other: Set<string>, setOther: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else {
      next.add(id);
      // Mutually exclusive with the other outcome - a student can't be
      // both detained and TC-issued.
      if (other.has(id)) {
        const nextOther = new Set(other);
        nextOther.delete(id);
        setOther(nextOther);
      }
    }
    setSet(next);
  };

  const promotedCount = students.length - detained.size - tcIssued.size;
  const canSubmit =
    !!fromClassId && !!toClassId && !!toSectionId && !!academicYearId && students.length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    if (
      !confirm(
        `Promote ${promotedCount} student(s) to ${toClass?.name}, detain ${detained.size}, issue TC to ${tcIssued.size}? This cannot be undone from this page.`
      )
    )
      return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.post("/academics/promote", {
        academicYearId,
        fromClassId,
        fromSectionId: fromSectionId || undefined,
        toClassId,
        toSectionId,
        detainedStudentIds: Array.from(detained),
        tcIssuedStudentIds: Array.from(tcIssued),
      });
      setResult(res.data.data);
      setStudents([]);
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to process promotion");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <ArrowUpCircle className="h-6 w-6 text-primary-600" /> Student Promotion
        </h1>
        <p className="text-gray-500 mt-1">
          Year-end promotion: move every active student from one class/section to the next, marking exceptions as
          Detained or TC Issued.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
        </div>
      ) : (
        <>
          <div className="card mb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="font-semibold text-sm text-gray-600 mb-3">From (current)</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Class *</label>
                    <select className="input-field" value={fromClassId} onChange={(e) => { setFromClassId(e.target.value); setFromSectionId(""); }}>
                      <option value="">Select class</option>
                      {classes.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Section (optional - all if blank)</label>
                    <select className="input-field" value={fromSectionId} onChange={(e) => setFromSectionId(e.target.value)} disabled={!fromClass}>
                      <option value="">All sections</option>
                      {fromClass?.sections.map((s) => (
                        <option key={s.id} value={s.id}>Section {s.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-sm text-gray-600 mb-3">To (next year)</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Class *</label>
                    <select className="input-field" value={toClassId} onChange={(e) => { setToClassId(e.target.value); setToSectionId(""); }}>
                      <option value="">Select class</option>
                      {classes.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Section *</label>
                    <select className="input-field" value={toSectionId} onChange={(e) => setToSectionId(e.target.value)} disabled={!toClass}>
                      <option value="">Select section</option>
                      {toClass?.sections.map((s) => (
                        <option key={s.id} value={s.id}>Section {s.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t">
              <label className="block text-xs font-medium text-gray-500 mb-1">Academic Year (this promotion is recorded against) *</label>
              <select className="input-field w-auto" value={academicYearId} onChange={(e) => setAcademicYearId(e.target.value)}>
                <option value="">Select academic year</option>
                {years.map((y) => (
                  <option key={y.id} value={y.id}>{y.name}{y.isActive ? " (active)" : ""}</option>
                ))}
              </select>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-lg text-sm mb-6 bg-red-50 text-red-700 border border-red-200">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {error}
            </div>
          )}

          {result && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-lg text-sm mb-6 bg-green-50 text-green-700 border border-green-200">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
              Done: {result.promoted} promoted, {result.detained} detained, {result.tcIssued} issued TC (of {result.total} total).
            </div>
          )}

          {fromClassId && (
            <div className="card">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <h3 className="font-semibold">
                  Students in {fromClass?.name}{fromSectionId ? ` - Section ${fromClass?.sections.find((s) => s.id === fromSectionId)?.name}` : ""}
                </h3>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-green-700">{promotedCount} promoted</span>
                  <span className="text-amber-700">{detained.size} detained</span>
                  <span className="text-red-700">{tcIssued.size} TC issued</span>
                </div>
              </div>

              {studentsLoading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" />
                </div>
              ) : students.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-8">No active students found in this class/section</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-gray-50">
                        <th className="px-3 py-2 text-left">Admission No</th>
                        <th className="px-3 py-2 text-left">Name</th>
                        <th className="px-3 py-2 text-left">Roll No</th>
                        <th className="px-3 py-2 text-center">Detain</th>
                        <th className="px-3 py-2 text-center">TC Issued</th>
                      </tr>
                    </thead>
                    <tbody>
                      {students.map((s) => (
                        <tr key={s.id} className="border-b">
                          <td className="px-3 py-2 font-mono text-xs">{s.admissionNo}</td>
                          <td className="px-3 py-2 font-medium">{s.user.name}</td>
                          <td className="px-3 py-2 text-gray-500">{s.rollNo || "-"}</td>
                          <td className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={detained.has(s.id)}
                              onChange={() => toggleSet(detained, setDetained, s.id, tcIssued, setTcIssued)}
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={tcIssued.has(s.id)}
                              onChange={() => toggleSet(tcIssued, setTcIssued, s.id, detained, setDetained)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex justify-end pt-4 mt-4 border-t">
                <button onClick={handleSubmit} disabled={!canSubmit} className="btn-primary disabled:opacity-50">
                  {submitting ? "Processing..." : `Confirm Promotion (${students.length} student(s))`}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
