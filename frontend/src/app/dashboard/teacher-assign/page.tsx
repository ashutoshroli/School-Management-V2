"use client";

import { useState, useEffect } from "react";
import { UserCog, School, BookOpen, Trash2, CheckCircle2, LayoutGrid, DoorOpen } from "lucide-react";
import api from "@/lib/api";

interface Teacher {
  id: string;
  user: { name: string };
}

interface ClassItem {
  id: string;
  name: string;
  sections: { id: string; name: string; classTeacherId: string | null }[];
}

interface Subject {
  id: string;
  name: string;
  code: string;
}

interface SubjectTeacherAssignment {
  id: string;
  staff: { id: string; user: { name: string } };
  subject: { id: string; name: string; code: string };
  class: { id: string; name: string } | null;
}

export default function TeacherAssignPage() {
  const [tab, setTab] = useState<"class" | "subject" | "matrix">("class");
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [classesRes, teachersRes, subjectsRes] = await Promise.all([
        api.get("/classes"),
        // TEACHING staff only - both a class teacher and a subject
        // teacher are always a teaching-role staff member.
        api.get("/staff", { params: { type: "TEACHING", limit: 200 } }),
        api.get("/classes/subjects"),
      ]);
      setClasses(classesRes.data.data || []);
      setTeachers(teachersRes.data.data || []);
      setSubjects(subjectsRes.data.data || []);
    } catch (err) {} finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <UserCog className="h-6 w-6 text-primary-600" /> Teacher Assign
        </h1>
        <p className="text-gray-500 mt-1">Assign a class teacher to a section, or a subject teacher to a class</p>
      </div>

      <div className="flex gap-2 border-b mb-6">
        <button
          onClick={() => setTab("class")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 ${tab === "class" ? "border-primary-600 text-primary-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}
        >
          <School className="h-4 w-4" /> Class Teacher
        </button>
        <button
          onClick={() => setTab("subject")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 ${tab === "subject" ? "border-primary-600 text-primary-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}
        >
          <BookOpen className="h-4 w-4" /> Subject Teacher
        </button>
        <button
          onClick={() => setTab("matrix")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 ${tab === "matrix" ? "border-primary-600 text-primary-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}
        >
          <LayoutGrid className="h-4 w-4" /> Class-wise View
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : tab === "class" ? (
        <ClassTeacherTab classes={classes} teachers={teachers} onChanged={fetchData} />
      ) : tab === "subject" ? (
        <SubjectTeacherTab classes={classes} teachers={teachers} subjects={subjects} />
      ) : (
        <ClassWiseMatrixTab classes={classes} teachers={teachers} subjects={subjects} />
      )}
    </div>
  );
}

// ==================== CLASS TEACHER TAB ====================
// "Who is the class teacher for this section" - backed by
// Section.classTeacherId (PUT /classes/sections/:id).

function ClassTeacherTab({
  classes, teachers, onChanged,
}: { classes: ClassItem[]; teachers: Teacher[]; onChanged: () => void }) {
  const [savingSectionId, setSavingSectionId] = useState<string | null>(null);
  const [savedSectionId, setSavedSectionId] = useState<string | null>(null);

  const handleAssign = async (sectionId: string, classTeacherId: string) => {
    setSavingSectionId(sectionId);
    setSavedSectionId(null);
    try {
      await api.put(`/classes/sections/${sectionId}`, { classTeacherId: classTeacherId || null });
      await onChanged();
      setSavedSectionId(sectionId);
      setTimeout(() => setSavedSectionId((prev) => (prev === sectionId ? null : prev)), 2000);
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to assign class teacher");
    } finally {
      setSavingSectionId(null);
    }
  };

  const teacherNameFor = (id: string | null) => teachers.find((t) => t.id === id)?.user.name || null;

  return (
    <div className="space-y-6">
      {classes.map((cls) => (
        <div key={cls.id} className="card">
          <h3 className="font-semibold text-gray-900 mb-3">{cls.name}</h3>
          {cls.sections.length === 0 ? (
            <p className="text-sm text-gray-400">No sections in this class yet</p>
          ) : (
            <div className="space-y-2">
              {cls.sections.map((sec) => (
                <div key={sec.id} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded-lg flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium">Section {sec.name}</span>
                    {sec.classTeacherId && (
                      <span className="text-xs text-gray-500">Currently: {teacherNameFor(sec.classTeacherId) || "Unknown"}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {savedSectionId === sec.id && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                    <select
                      className="input-field w-auto text-sm"
                      value={sec.classTeacherId || ""}
                      disabled={savingSectionId === sec.id}
                      onChange={(e) => handleAssign(sec.id, e.target.value)}
                    >
                      <option value="">Not assigned</option>
                      {teachers.map((t) => <option key={t.id} value={t.id}>{t.user.name}</option>)}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      {classes.length === 0 && (
        <p className="text-sm text-gray-500">No classes found. Create one under Classes first.</p>
      )}
    </div>
  );
}

// ==================== SUBJECT TEACHER TAB ====================
// "Who teaches Subject X to Class Y" - backed by the SubjectTeacher
// model (POST/GET/DELETE /classes/subject-teachers).

function SubjectTeacherTab({
  classes, teachers, subjects,
}: { classes: ClassItem[]; teachers: Teacher[]; subjects: Subject[] }) {
  const [classId, setClassId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignments, setAssignments] = useState<SubjectTeacherAssignment[]>([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  // Narrow the "Current Assignments" list further by teacher/subject -
  // previously impossible on the backend (getSubjectTeachers only
  // supported a classId filter).
  const [filterStaffId, setFilterStaffId] = useState("");
  const [filterSubjectId, setFilterSubjectId] = useState("");

  const fetchAssignments = async (forClassId: string, staffFilter?: string, subjectFilter?: string) => {
    if (!forClassId) { setAssignments([]); return; }
    setAssignmentsLoading(true);
    try {
      const res = await api.get("/classes/subject-teachers", {
        params: { classId: forClassId, staffId: staffFilter || undefined, subjectId: subjectFilter || undefined },
      });
      setAssignments(res.data.data || []);
    } catch {
      setAssignments([]);
    } finally {
      setAssignmentsLoading(false);
    }
  };

  useEffect(() => {
    fetchAssignments(classId, filterStaffId, filterSubjectId);
    setSubjectId("");
    setStaffId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  useEffect(() => {
    if (classId) fetchAssignments(classId, filterStaffId, filterSubjectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStaffId, filterSubjectId]);

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!classId || !subjectId || !staffId) return;
    setAssigning(true);
    try {
      await api.post("/classes/subject-teachers", { classId, subjectId, staffId });
      setSubjectId("");
      setStaffId("");
      await fetchAssignments(classId, filterStaffId, filterSubjectId);
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to assign subject teacher");
    } finally {
      setAssigning(false);
    }
  };

  const handleRemove = async (id: string) => {
    if (!confirm("Remove this subject-teacher assignment?")) return;
    setRemovingId(id);
    try {
      await api.delete(`/classes/subject-teachers/${id}`);
      await fetchAssignments(classId, filterStaffId, filterSubjectId);
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to remove assignment");
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <label className="block text-sm font-medium text-gray-700 mb-1">Class *</label>
        <select className="input-field max-w-xl" value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">Select a class</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {classId && (
        <div className="card space-y-4">
          <form onSubmit={handleAssign} className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[160px]">
              <label className="block text-sm font-medium text-gray-700 mb-1">Subject *</label>
              <select className="input-field" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} required>
                <option value="">Select subject</option>
                {subjects.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
              </select>
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="block text-sm font-medium text-gray-700 mb-1">Teacher *</label>
              <select className="input-field" value={staffId} onChange={(e) => setStaffId(e.target.value)} required>
                <option value="">Select teacher</option>
                {teachers.map((t) => <option key={t.id} value={t.id}>{t.user.name}</option>)}
              </select>
            </div>
            <button type="submit" disabled={assigning} className="btn-primary disabled:opacity-50">
              {assigning ? "Assigning..." : "Assign"}
            </button>
          </form>

          <div className="pt-2 border-t">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <h4 className="text-sm font-semibold text-gray-600">Current Assignments</h4>
              <div className="flex gap-2">
                <select className="input-field w-auto text-xs" value={filterSubjectId} onChange={(e) => setFilterSubjectId(e.target.value)}>
                  <option value="">All Subjects</option>
                  {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <select className="input-field w-auto text-xs" value={filterStaffId} onChange={(e) => setFilterStaffId(e.target.value)}>
                  <option value="">All Teachers</option>
                  {teachers.map((t) => <option key={t.id} value={t.id}>{t.user.name}</option>)}
                </select>
              </div>
            </div>
            {assignmentsLoading ? (
              <div className="flex justify-center py-4">
                <div className="animate-spin h-5 w-5 border-4 border-primary-600 border-t-transparent rounded-full" />
              </div>
            ) : assignments.length === 0 ? (
              <p className="text-sm text-gray-400">No subject teachers assigned to this class yet</p>
            ) : (
              <div className="space-y-2">
                {assignments.map((a) => (
                  <div key={a.id} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded-lg">
                    <div className="text-sm">
                      <span className="font-medium">{a.subject.name}</span>
                      <span className="text-gray-400"> ({a.subject.code})</span>
                      <span className="text-gray-500"> &bull; {a.staff.user.name}</span>
                    </div>
                    <button
                      onClick={() => handleRemove(a.id)}
                      disabled={removingId === a.id}
                      title="Remove"
                      className="p-1.5 text-red-500 hover:bg-red-50 rounded disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


// ==================== CLASS-WISE MATRIX TAB ====================
// Combined "who teaches what, in which section/room" view for a whole
// class, using the new getClassSubjectMatrix endpoint - previously
// this same picture required manually cross-referencing the other two
// tabs (Class Teacher + Subject Teacher) subject by subject.

interface MatrixData {
  class: { id: string; name: string };
  sections: {
    id: string;
    name: string;
    classTeacher: { id: string; user: { name: string } } | null;
    room: { id: string; roomNo: string; name: string | null } | null;
    _count: { students: number };
  }[];
  subjects: {
    subject: { id: string; name: string; code: string };
    teachers: { assignmentId: string; staffId: string; staffName: string; classSpecific: boolean }[];
  }[];
}

function ClassWiseMatrixTab({
  classes, teachers, subjects,
}: { classes: ClassItem[]; teachers: Teacher[]; subjects: Subject[] }) {
  const [classId, setClassId] = useState("");
  const [matrix, setMatrix] = useState<MatrixData | null>(null);
  const [loading, setLoading] = useState(false);
  const [quickSubjectId, setQuickSubjectId] = useState("");
  const [quickStaffId, setQuickStaffId] = useState("");
  const [assigning, setAssigning] = useState(false);

  const fetchMatrix = async (id: string) => {
    if (!id) { setMatrix(null); return; }
    setLoading(true);
    try {
      const res = await api.get(`/classes/${id}/subject-matrix`);
      setMatrix(res.data.data);
    } catch {
      setMatrix(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchMatrix(classId); setQuickSubjectId(""); setQuickStaffId(""); }, [classId]);

  const handleQuickAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!classId || !quickSubjectId || !quickStaffId) return;
    setAssigning(true);
    try {
      await api.post("/classes/subject-teachers", { classId, subjectId: quickSubjectId, staffId: quickStaffId });
      setQuickSubjectId("");
      setQuickStaffId("");
      await fetchMatrix(classId);
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to assign subject teacher");
    } finally {
      setAssigning(false);
    }
  };

  const handleAssignSubjectToClass = async (subjectId: string) => {
    if (!classId) return;
    try {
      await api.post("/classes/subjects/assign", { classId, subjectId });
      await fetchMatrix(classId);
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to assign subject to class");
    }
  };

  const unassignedSubjects = subjects.filter((s) => !matrix?.subjects.some((m) => m.subject.id === s.id));

  return (
    <div className="space-y-6">
      <div className="card">
        <label className="block text-sm font-medium text-gray-700 mb-1">Class *</label>
        <select className="input-field max-w-xl" value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">Select a class</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : matrix && (
        <>
          <div className="card">
            <h4 className="text-sm font-semibold text-gray-600 mb-3 flex items-center gap-1.5"><School className="h-4 w-4" /> Sections</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {matrix.sections.map((sec) => (
                <div key={sec.id} className="bg-gray-50 rounded-lg p-3 text-sm">
                  <p className="font-medium">Section {sec.name} <span className="text-gray-400 text-xs">({sec._count.students} students)</span></p>
                  <p className="text-gray-500 text-xs mt-1">Class Teacher: {sec.classTeacher?.user.name || "Not assigned"}</p>
                  <p className="text-gray-500 text-xs flex items-center gap-1">
                    <DoorOpen className="h-3 w-3" /> {sec.room ? (sec.room.name || sec.room.roomNo) : "No room assigned"}
                  </p>
                </div>
              ))}
              {matrix.sections.length === 0 && <p className="text-sm text-gray-400 col-span-full">No sections in this class yet</p>}
            </div>
          </div>

          <div className="card">
            <h4 className="text-sm font-semibold text-gray-600 mb-3 flex items-center gap-1.5"><BookOpen className="h-4 w-4" /> Subjects &amp; Teachers</h4>
            {matrix.subjects.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b bg-gray-50">
                    <th className="px-3 py-2 text-left">Subject</th>
                    <th className="px-3 py-2 text-left">Teacher(s)</th>
                  </tr></thead>
                  <tbody>
                    {matrix.subjects.map((row) => (
                      <tr key={row.subject.id} className="border-b">
                        <td className="px-3 py-2 font-medium">{row.subject.name} <span className="text-gray-400 text-xs">({row.subject.code})</span></td>
                        <td className="px-3 py-2">
                          {row.teachers.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {row.teachers.map((t) => (
                                <span key={t.assignmentId} className={`text-xs px-2 py-0.5 rounded-full ${t.classSpecific ? "bg-primary-100 text-primary-700" : "bg-gray-100 text-gray-600"}`} title={t.classSpecific ? "Assigned specifically for this class" : "School-wide default for this subject"}>
                                  {t.staffName}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-red-500">No teacher assigned</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-gray-400">No subjects assigned to this class yet - use the picker below.</p>
            )}

            {unassignedSubjects.length > 0 && (
              <div className="mt-4 pt-4 border-t">
                <p className="text-xs text-gray-500 mb-2">Add a subject to this class:</p>
                <div className="flex flex-wrap gap-2">
                  {unassignedSubjects.map((s) => (
                    <button key={s.id} onClick={() => handleAssignSubjectToClass(s.id)} className="text-xs px-2.5 py-1 border border-primary-200 text-primary-600 hover:bg-primary-50 rounded-full">
                      + {s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <h4 className="text-sm font-semibold text-gray-600 mb-3">Quick-Assign a Teacher</h4>
            <form onSubmit={handleQuickAssign} className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[160px]">
                <label className="block text-sm font-medium text-gray-700 mb-1">Subject *</label>
                <select className="input-field" value={quickSubjectId} onChange={(e) => setQuickSubjectId(e.target.value)} required>
                  <option value="">Select subject</option>
                  {matrix.subjects.map((row) => <option key={row.subject.id} value={row.subject.id}>{row.subject.name}</option>)}
                </select>
              </div>
              <div className="flex-1 min-w-[160px]">
                <label className="block text-sm font-medium text-gray-700 mb-1">Teacher *</label>
                <select className="input-field" value={quickStaffId} onChange={(e) => setQuickStaffId(e.target.value)} required>
                  <option value="">Select teacher</option>
                  {teachers.map((t) => <option key={t.id} value={t.id}>{t.user.name}</option>)}
                </select>
              </div>
              <button type="submit" disabled={assigning} className="btn-primary disabled:opacity-50">
                {assigning ? "Assigning..." : "Assign"}
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
