"use client";

import { useState, useEffect } from "react";
import { FileText, Plus, Edit, Trash2, Eye } from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";
import { formatDate } from "@/lib/utils";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/hooks/useAuth";

const EMPTY_FORM = { name: "", type: "UNIT_TEST", classId: "", academicYearId: "", startDate: "", endDate: "", sectionId: "", subjectId: "" };

export default function ExamsPage() {
  const { canEdit, canDelete } = usePermissions();
  const { user } = useAuth();
  // Creation-rights scoping (spec Section 9): a TEACHER (unlike
  // Admin/Principal/VP) may only create a CUSTOM exam scoped to
  // either a section they're the Class Teacher of, or a subject they
  // teach - never a whole-class exam with neither. The backend's
  // authorize() only just started allowing TEACHER on this route at
  // all (previously blocked outright) - this form now actually
  // surfaces the Section/Subject picker that createExam's own scoping
  // logic needs from a TEACHER caller.
  const isTeacher = user?.role === "TEACHER";
  const [exams, setExams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [classes, setClasses] = useState<any[]>([]);
  const [years, setYears] = useState<any[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  // "CLASS_TEACHER" (pick one of my own sections) or "SUBJECT_TEACHER"
  // (pick one of my own taught subjects) - only relevant when
  // isTeacher; determines which of sectionId/subjectId is actually
  // sent to createExam (the backend requires exactly one, not both).
  const [teacherScopeMode, setTeacherScopeMode] = useState<"CLASS_TEACHER" | "SUBJECT_TEACHER">("CLASS_TEACHER");
  const [myScope, setMyScope] = useState<{ classTeacherSections: any[]; subjectAssignments: any[] }>({ classTeacherSections: [], subjectAssignments: [] });

  // View Details - the list view only shows a handful of summary
  // columns; this drills into one exam via the new getExamById
  // endpoint for its subject-wise marks-recorded summary.
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [attendanceSummary, setAttendanceSummary] = useState<any[]>([]);

  const openDetail = async (id: string) => {
    setDetail({});
    setAttendanceSummary([]);
    setDetailLoading(true);
    try {
      const [detailRes, attendanceRes] = await Promise.all([
        api.get(`/academics/exams/${id}`),
        api.get(`/academics/exams/${id}/attendance-summary`).catch(() => ({ data: { data: [] } })),
      ]);
      setDetail(detailRes.data.data);
      setAttendanceSummary(attendanceRes.data.data || []);
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to load exam details");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const fetch = async () => {
    setLoading(true);
    try {
      const [eRes, cRes, yRes] = await Promise.all([
        api.get("/academics/exams"), api.get("/classes"), api.get("/academic-years")
      ]);
      setExams(eRes.data.data || []);
      setClasses(cRes.data.data || []);
      setYears(yRes.data.data || []);
    } catch {} finally { setLoading(false); }
  };
  useEffect(() => { fetch(); }, []);

  // Load the teacher's own creation scope once - unused/harmless for
  // any other role (isTeacher gates its actual use below).
  useEffect(() => {
    if (!isTeacher) return;
    api.get("/academics/exams/my-creation-scope")
      .then((res) => setMyScope(res.data.data || { classTeacherSections: [], subjectAssignments: [] }))
      .catch(() => setMyScope({ classTeacherSections: [], subjectAssignments: [] }));
  }, [isTeacher]);

  const openCreateModal = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    // Default to whichever scope this teacher actually has - a
    // teacher who is only a Subject Teacher (no section of their own)
    // shouldn't land on a mode with zero options.
    if (isTeacher && myScope.classTeacherSections.length === 0 && myScope.subjectAssignments.length > 0) {
      setTeacherScopeMode("SUBJECT_TEACHER");
    } else {
      setTeacherScopeMode("CLASS_TEACHER");
    }
    setShowModal(true);
  };

  const openEditModal = (e: any) => {
    setEditingId(e.id);
    setForm({
      name: e.name,
      type: e.type,
      classId: e.classId,
      academicYearId: e.academicYearId,
      startDate: e.startDate ? new Date(e.startDate).toISOString().slice(0, 10) : "",
      endDate: e.endDate ? new Date(e.endDate).toISOString().slice(0, 10) : "",
      // sectionId/subjectId are never sent by updateExam (see
      // handleSubmit's editingId branch), but the form's state shape
      // (inferred from EMPTY_FORM) requires both keys to be present -
      // omitting them here is a TypeScript strict-mode error, not just
      // a runtime no-op.
      sectionId: "",
      subjectId: "",
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        // classId/academicYearId aren't editable server-side (see
        // exam.controller.ts's updateExam) - only send the fields it
        // actually supports.
        await api.put(`/academics/exams/${editingId}`, {
          name: form.name,
          type: form.type,
          startDate: form.startDate,
          endDate: form.endDate,
        });
      } else if (isTeacher) {
        // Send exactly one of sectionId/subjectId, matching whichever
        // scope mode is active - createExam rejects a TEACHER request
        // with neither (or treats classId/academicYearId as still
        // required regardless of scope).
        await api.post("/academics/exams", {
          name: form.name, type: form.type, classId: form.classId, academicYearId: form.academicYearId,
          startDate: form.startDate, endDate: form.endDate,
          ...(teacherScopeMode === "CLASS_TEACHER" ? { sectionId: form.sectionId } : { subjectId: form.subjectId }),
        });
      } else {
        await api.post("/academics/exams", form);
      }
      setShowModal(false); fetch();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete exam "${name}"?`)) return;
    try {
      await api.delete(`/academics/exams/${id}`);
      fetch();
    } catch (err: any) { alert(err.response?.data?.message || "Cannot delete this exam"); }
  };

  const togglePublish = async (id: string) => {
    await api.patch(`/academics/exams/${id}/publish`);
    fetch();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2"><FileText className="h-6 w-6 text-primary-600" /> Exams</h1>
        {/* A TEACHER with no Class-Teacher section AND no Subject-Teacher
            assignment has no valid scope to create an exam in at all
            (createExam would 400/403 either way) - hide the button
            rather than let them hit that dead end. */}
        {(!isTeacher || myScope.classTeacherSections.length > 0 || myScope.subjectAssignments.length > 0) && (
          <button onClick={openCreateModal} className="btn-primary flex items-center gap-2"><Plus className="h-4 w-4" /> Create Exam</button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-gray-50">
              <th className="px-4 py-3 text-left">Exam Name</th>
              <th className="px-4 py-3 text-left">Type</th>
              <th className="px-4 py-3 text-left">Class</th>
              <th className="px-4 py-3 text-left">Date</th>
              <th className="px-4 py-3 text-center">Published</th>
              <th className="px-4 py-3 text-center">Actions</th>
            </tr></thead>
            <tbody>
              {exams.map(e => (
                <tr key={e.id} className="border-b">
                  <td className="px-4 py-3 font-medium">{e.name}</td>
                  <td className="px-4 py-3"><span className="px-2 py-0.5 bg-gray-100 rounded text-xs">{e.type}</span></td>
                  <td className="px-4 py-3">{e.class?.name}</td>
                  <td className="px-4 py-3 text-xs">{e.startDate ? formatDate(e.startDate) : "-"}</td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => togglePublish(e.id)} className={`px-2 py-0.5 rounded-full text-xs ${e.isPublished ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                      {e.isPublished ? "Published" : "Draft"}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-3">
                      <button onClick={() => openDetail(e.id)} title="View Details" className="text-gray-500 hover:text-gray-700">
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <a href={`/dashboard/exams/${e.id}/schedule`} className="text-primary-600 text-xs font-medium hover:underline">Timetable</a>
                      <a href={`/dashboard/exams/${e.id}/results`} className="text-primary-600 text-xs font-medium hover:underline">Results</a>
                      <a href={`/dashboard/exams/${e.id}/marks`} className="text-primary-600 text-xs font-medium hover:underline">Enter Marks</a>
                      {canEdit && (
                        <button onClick={() => openEditModal(e)} title="Edit" className="text-gray-500 hover:text-gray-700">
                          <Edit className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {canDelete && (
                        <button onClick={() => handleDelete(e.id, e.name)} title="Delete" className="text-red-500 hover:text-red-700">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editingId ? "Edit Exam" : "Create Exam"}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {isTeacher && !editingId && (myScope.classTeacherSections.length > 0 || myScope.subjectAssignments.length > 0) && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-xs text-blue-700 mb-2">
                As a Teacher, you may only create a custom exam for your own section (as Class Teacher) or your own subject (as Subject Teacher).
              </p>
              <div className="flex gap-2">
                {myScope.classTeacherSections.length > 0 && (
                  <button type="button" onClick={() => { setTeacherScopeMode("CLASS_TEACHER"); setForm((f) => ({ ...f, classId: "", sectionId: "", subjectId: "" })); }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium ${teacherScopeMode === "CLASS_TEACHER" ? "bg-primary-600 text-white" : "bg-white border"}`}>
                    As Class Teacher
                  </button>
                )}
                {myScope.subjectAssignments.length > 0 && (
                  <button type="button" onClick={() => { setTeacherScopeMode("SUBJECT_TEACHER"); setForm((f) => ({ ...f, classId: "", sectionId: "", subjectId: "" })); }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium ${teacherScopeMode === "SUBJECT_TEACHER" ? "bg-primary-600 text-white" : "bg-white border"}`}>
                    As Subject Teacher
                  </button>
                )}
              </div>
            </div>
          )}
          <div><label className="block text-sm font-medium mb-1">Exam Name *</label>
            <input className="input-field" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Type</label>
              <select className="input-field" value={form.type} onChange={e => setForm({...form, type: e.target.value})}>
                <option value="UNIT_TEST">Unit Test</option><option value="HALF_YEARLY">Half Yearly</option>
                <option value="ANNUAL">Annual</option><option value="PRE_BOARD">Pre-Board</option>
              </select></div>

            {isTeacher && !editingId && teacherScopeMode === "CLASS_TEACHER" ? (
              <div>
                <label className="block text-sm font-medium mb-1">Section (as Class Teacher) *</label>
                <select
                  className="input-field"
                  value={form.sectionId}
                  onChange={(e) => {
                    const sec = myScope.classTeacherSections.find((s) => s.sectionId === e.target.value);
                    setForm({ ...form, sectionId: e.target.value, classId: sec?.classId || "" });
                  }}
                  required
                >
                  <option value="">Select</option>
                  {myScope.classTeacherSections.map((s) => (
                    <option key={s.sectionId} value={s.sectionId}>{s.className} - {s.sectionName}</option>
                  ))}
                </select>
              </div>
            ) : isTeacher && !editingId && teacherScopeMode === "SUBJECT_TEACHER" ? (
              <div>
                <label className="block text-sm font-medium mb-1">Subject / Class (as Subject Teacher) *</label>
                <select
                  className="input-field"
                  value={form.subjectId ? `${form.subjectId}|${form.classId}` : ""}
                  onChange={(e) => {
                    const [subjectId, classId] = e.target.value.split("|");
                    setForm({ ...form, subjectId, classId: classId || "" });
                  }}
                  required
                >
                  <option value="">Select</option>
                  {myScope.subjectAssignments.map((a, i) => (
                    <option key={`${a.subjectId}-${a.classId || "any"}-${i}`} value={`${a.subjectId}|${a.classId || ""}`}>
                      {a.subjectName} {a.className ? `- ${a.className}` : "(all classes, default)"}
                    </option>
                  ))}
                </select>
                {form.subjectId && !form.classId && (
                  <>
                    <p className="text-xs text-amber-600 mt-1">This is your school-wide default for this subject - pick which class this exam is for.</p>
                    <select className="input-field mt-2" value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })} required>
                      <option value="">Select Class</option>
                      {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </>
                )}
              </div>
            ) : (
              <div><label className="block text-sm font-medium mb-1">Class *</label>
                <select className="input-field" value={form.classId} onChange={e => setForm({...form, classId: e.target.value})} required disabled={!!editingId}>
                  <option value="">Select</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select></div>
            )}

            <div><label className="block text-sm font-medium mb-1">Academic Year *</label>
              <select className="input-field" value={form.academicYearId} onChange={e => setForm({...form, academicYearId: e.target.value})} required disabled={!!editingId}>
                <option value="">Select</option>{years.map(y => <option key={y.id} value={y.id}>{y.name}</option>)}
              </select></div>
            <div><label className="block text-sm font-medium mb-1">Start Date</label>
              <input type="date" className="input-field" value={form.startDate} onChange={e => setForm({...form, startDate: e.target.value})} /></div>
            <div><label className="block text-sm font-medium mb-1">End Date</label>
              <input type="date" className="input-field" value={form.endDate} onChange={e => setForm({...form, endDate: e.target.value})} /></div>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">{editingId ? "Save Changes" : "Create"}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!detail} onClose={() => setDetail(null)} title={detail?.name ? `Exam - ${detail.name}` : "Exam Details"}>
        {detailLoading ? (
          <div className="flex justify-center py-8"><div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
        ) : detail ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-gray-500">Class</p><p className="font-medium">{detail.class?.name}</p></div>
              <div><p className="text-gray-500">Academic Year</p><p className="font-medium">{detail.academicYear?.name}</p></div>
              <div><p className="text-gray-500">Type</p><p className="font-medium">{detail.type}</p></div>
              <div><p className="text-gray-500">Status</p><p className="font-medium">{detail.isPublished ? "Published" : "Draft"}</p></div>
              <div><p className="text-gray-500">Start Date</p><p className="font-medium">{detail.startDate ? formatDate(detail.startDate) : "-"}</p></div>
              <div><p className="text-gray-500">End Date</p><p className="font-medium">{detail.endDate ? formatDate(detail.endDate) : "-"}</p></div>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-gray-600 mb-2">Marks Recorded by Subject</h4>
              {detail.marksSummary?.length > 0 ? (
                <div className="space-y-1.5">
                  {detail.marksSummary.map((m: any) => (
                    <div key={m.subject?.id} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded-lg text-sm">
                      <span>{m.subject?.name} ({m.subject?.code})</span>
                      <span className="text-xs font-medium text-gray-600">{m.marksRecorded} student(s)</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">No marks recorded yet for any subject.</p>
              )}
            </div>
            <div>
              <h4 className="text-sm font-semibold text-gray-600 mb-2">Exam Attendance by Subject</h4>
              {attendanceSummary.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-gray-500"><th className="text-left py-1">Subject</th><th className="text-center py-1">Present</th><th className="text-center py-1">Absent</th><th className="text-center py-1">Late</th><th className="text-center py-1">Unfair Means</th></tr></thead>
                    <tbody>
                      {attendanceSummary.map((s: any) => (
                        <tr key={s.examScheduleId} className="border-t">
                          <td className="py-1">{s.subject}</td>
                          <td className="py-1 text-center">{s.PRESENT}</td>
                          <td className="py-1 text-center">{s.ABSENT}</td>
                          <td className="py-1 text-center">{s.LATE}</td>
                          <td className="py-1 text-center">{s.UNFAIR_MEANS}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-gray-400">No exam attendance recorded yet for any subject.</p>
              )}
            </div>
            <div className="flex justify-end pt-2 border-t">
              <button type="button" onClick={() => setDetail(null)} className="btn-secondary">Close</button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
