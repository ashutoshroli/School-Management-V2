"use client";

import { useState, useEffect } from "react";
import { UserCog, School, BookOpen, Trash2, CheckCircle2 } from "lucide-react";
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
  const [tab, setTab] = useState<"class" | "subject">("class");
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
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : tab === "class" ? (
        <ClassTeacherTab classes={classes} teachers={teachers} onChanged={fetchData} />
      ) : (
        <SubjectTeacherTab classes={classes} teachers={teachers} subjects={subjects} />
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

  const fetchAssignments = async (forClassId: string) => {
    if (!forClassId) { setAssignments([]); return; }
    setAssignmentsLoading(true);
    try {
      const res = await api.get("/classes/subject-teachers", { params: { classId: forClassId } });
      setAssignments(res.data.data || []);
    } catch {
      setAssignments([]);
    } finally {
      setAssignmentsLoading(false);
    }
  };

  useEffect(() => {
    fetchAssignments(classId);
    setSubjectId("");
    setStaffId("");
  }, [classId]);

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!classId || !subjectId || !staffId) return;
    setAssigning(true);
    try {
      await api.post("/classes/subject-teachers", { classId, subjectId, staffId });
      setSubjectId("");
      setStaffId("");
      await fetchAssignments(classId);
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
      await fetchAssignments(classId);
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
            <h4 className="text-sm font-semibold text-gray-600 mb-2">Current Assignments</h4>
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
