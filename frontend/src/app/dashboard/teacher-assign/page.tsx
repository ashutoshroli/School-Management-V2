"use client";

import { useState, useEffect } from "react";
import { UserCog, School, BookOpen, Trash2, CheckCircle2, LayoutGrid, DoorOpen, Building2 } from "lucide-react";
import api from "@/lib/api";
import { usePermissions } from "@/hooks/usePermissions";

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
  const [tab, setTab] = useState<"class" | "subject" | "matrix" | "rooms">("class");
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
        <p className="text-gray-500 mt-1">Assign a class teacher to a section, a subject teacher to a class, or rooms to sections</p>
      </div>

      <div className="flex gap-2 border-b mb-6 flex-wrap">
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
        <button
          onClick={() => setTab("rooms")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 ${tab === "rooms" ? "border-primary-600 text-primary-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}
        >
          <Building2 className="h-4 w-4" /> Class/Room Assign
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : tab === "class" ? (
        <ClassTeacherTab classes={classes} teachers={teachers} onChanged={fetchData} />
      ) : tab === "subject" ? (
        <SubjectTeacherTab classes={classes} teachers={teachers} subjects={subjects} />
      ) : tab === "matrix" ? (
        <ClassWiseMatrixTab classes={classes} teachers={teachers} subjects={subjects} />
      ) : (
        <ClassRoomAssignTab classes={classes} />
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
  const { canDelete } = usePermissions();
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
  // Point 11 (Class-wise Subject Selection): the Subject picker below
  // is narrowed to ONLY this class's assigned subjects (ClassSubject)
  // once a class is selected - previously showed every subject in the
  // branch regardless of class, letting a teacher be assigned for a
  // subject/class combo the class doesn't even teach.
  const [classSubjects, setClassSubjects] = useState<Subject[]>([]);
  const [classSubjectsLoading, setClassSubjectsLoading] = useState(false);

  useEffect(() => {
    if (!classId) { setClassSubjects([]); return; }
    setClassSubjectsLoading(true);
    api.get(`/classes/${classId}/subjects`)
      .then((res) => setClassSubjects((res.data.data || []).map((cs: any) => cs.subject)))
      .catch(() => setClassSubjects([]))
      .finally(() => setClassSubjectsLoading(false));
  }, [classId]);

  const subjectOptions = classId && classSubjects.length > 0 ? classSubjects : subjects;

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
              <select className="input-field" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} required disabled={classSubjectsLoading}>
                <option value="">{classSubjectsLoading ? "Loading..." : "Select subject"}</option>
                {subjectOptions.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
              </select>
              {classId && classSubjects.length === 0 && !classSubjectsLoading && (
                <p className="text-xs text-amber-600 mt-1">No subjects assigned to this class yet.</p>
              )}
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
                    {canDelete && (
                      <button
                        onClick={() => handleRemove(a.id)}
                        disabled={removingId === a.id}
                        title="Remove"
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded disabled:opacity-40"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
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


// ==================== CLASS/ROOM ASSIGN TAB (Point 7) ====================
// Multi-select bulk assignment: pick several sections (across one or
// more classes) AND several rooms at once, then link every selected
// section to every selected room in one call via the new
// /classes/section-rooms/bulk endpoint. This is ADDITIVE to each
// section's single primary classroom (Classes page's Section.roomId)
// - these are extra shared rooms (e.g. a Lab/Library/Auditorium slot)
// a section also uses.

interface RoomOption {
  id: string;
  roomNo: string;
  name: string | null;
  type: string;
  buildingName: string;
}

interface SectionRoomLink {
  id: string;
  section: { id: string; name: string; class: { id: string; name: string } };
  room: { id: string; roomNo: string; name: string | null; type: string };
}

function ClassRoomAssignTab({ classes }: { classes: ClassItem[] }) {
  const { canDelete } = usePermissions();
  const [rooms, setRooms] = useState<RoomOption[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [selectedSectionIds, setSelectedSectionIds] = useState<string[]>([]);
  const [selectedRoomIds, setSelectedRoomIds] = useState<string[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);
  const [links, setLinks] = useState<SectionRoomLink[]>([]);
  const [linksLoading, setLinksLoading] = useState(true);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const fetchRooms = async () => {
    setRoomsLoading(true);
    try {
      const res = await api.get("/facilities/school-buildings");
      const buildings = res.data.data || [];
      const flat: RoomOption[] = buildings.flatMap((b: any) =>
        (b.floors || []).flatMap((f: any) =>
          (f.rooms || []).map((r: any) => ({ id: r.id, roomNo: r.roomNo, name: r.name, type: r.type, buildingName: b.name }))
        )
      );
      setRooms(flat);
    } catch {
      setRooms([]);
    } finally {
      setRoomsLoading(false);
    }
  };

  const fetchLinks = async () => {
    setLinksLoading(true);
    try {
      const res = await api.get("/classes/section-rooms");
      setLinks(res.data.data || []);
    } catch {
      setLinks([]);
    } finally {
      setLinksLoading(false);
    }
  };

  useEffect(() => { fetchRooms(); fetchLinks(); }, []);

  const toggleSection = (sectionId: string) => {
    setSelectedSectionIds((prev) => (prev.includes(sectionId) ? prev.filter((id) => id !== sectionId) : [...prev, sectionId]));
  };
  const toggleRoom = (roomId: string) => {
    setSelectedRoomIds((prev) => (prev.includes(roomId) ? prev.filter((id) => id !== roomId) : [...prev, roomId]));
  };

  const handleBulkAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedSectionIds.length === 0 || selectedRoomIds.length === 0) return;
    setAssigning(true);
    setResult(null);
    try {
      const res = await api.post("/classes/section-rooms/bulk", {
        sectionIds: selectedSectionIds,
        roomIds: selectedRoomIds,
      });
      setResult(res.data.data);
      setSelectedSectionIds([]);
      setSelectedRoomIds([]);
      await fetchLinks();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to bulk-assign rooms to sections");
    } finally {
      setAssigning(false);
    }
  };

  const handleRemoveLink = async (id: string) => {
    if (!confirm("Unlink this room from this section?")) return;
    setRemovingId(id);
    try {
      await api.delete(`/classes/section-rooms/${id}`);
      await fetchLinks();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to remove link");
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <h4 className="text-sm font-semibold text-gray-600 mb-1">Bulk Assign Rooms to Sections</h4>
        <p className="text-xs text-gray-400 mb-4">
          Select multiple classes/sections AND multiple rooms below, then click Assign to link every selected
          section to every selected room at once (e.g. give Sections A, B, C shared access to Lab 1 and the
          Library Hall). This is IN ADDITION to each section&apos;s single primary classroom set on the Classes page.
        </p>

        {result && (
          <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-3 py-2 mb-4">
            Linked {result.created} section-room pair(s){result.skipped > 0 ? `, ${result.skipped} already linked` : ""}.
          </div>
        )}

        <form onSubmit={handleBulkAssign} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Classes / Sections *</p>
              <div className="border rounded-lg max-h-64 overflow-y-auto divide-y">
                {classes.map((cls) => (
                  <div key={cls.id} className="p-2">
                    <p className="text-xs font-semibold text-gray-500 mb-1">{cls.name}</p>
                    {cls.sections.length === 0 ? (
                      <p className="text-xs text-gray-400 px-2">No sections</p>
                    ) : (
                      <div className="space-y-1">
                        {cls.sections.map((sec) => (
                          <label key={sec.id} className="flex items-center gap-2 text-sm px-2 py-1 rounded hover:bg-gray-50 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedSectionIds.includes(sec.id)}
                              onChange={() => toggleSection(sec.id)}
                            />
                            Section {sec.name}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {classes.length === 0 && <p className="text-sm text-gray-400 p-3">No classes found</p>}
              </div>
              <p className="text-xs text-gray-400 mt-1">{selectedSectionIds.length} section(s) selected</p>
            </div>

            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Rooms *</p>
              {roomsLoading ? (
                <div className="flex justify-center py-6"><div className="animate-spin h-5 w-5 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
              ) : (
                <div className="border rounded-lg max-h-64 overflow-y-auto divide-y">
                  {rooms.map((r) => (
                    <label key={r.id} className="flex items-center gap-2 text-sm px-3 py-1.5 hover:bg-gray-50 cursor-pointer">
                      <input type="checkbox" checked={selectedRoomIds.includes(r.id)} onChange={() => toggleRoom(r.id)} />
                      <span className="flex-1">{r.buildingName} - {r.name || r.roomNo}</span>
                      <span className="text-xs text-gray-400">{r.type.replace(/_/g, " ")}</span>
                    </label>
                  ))}
                  {rooms.length === 0 && <p className="text-sm text-gray-400 p-3">No rooms found - set up School Buildings first</p>}
                </div>
              )}
              <p className="text-xs text-gray-400 mt-1">{selectedRoomIds.length} room(s) selected</p>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={assigning || selectedSectionIds.length === 0 || selectedRoomIds.length === 0}
              className="btn-primary disabled:opacity-50"
            >
              {assigning ? "Assigning..." : `Assign ${selectedRoomIds.length || ""} Room(s) to ${selectedSectionIds.length || ""} Section(s)`}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h4 className="text-sm font-semibold text-gray-600 mb-3">Current Additional Room Links</h4>
        {linksLoading ? (
          <div className="flex justify-center py-6"><div className="animate-spin h-5 w-5 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
        ) : links.length === 0 ? (
          <p className="text-sm text-gray-400">No additional rooms linked to any section yet.</p>
        ) : (
          <div className="space-y-2">
            {links.map((l) => (
              <div key={l.id} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded-lg">
                <div className="text-sm">
                  <span className="font-medium">{l.section.class.name} - Section {l.section.name}</span>
                  <span className="text-gray-400"> &bull; </span>
                  <span className="text-gray-600">{l.room.name || l.room.roomNo} ({l.room.type.replace(/_/g, " ")})</span>
                </div>
                {canDelete && (
                  <button
                    onClick={() => handleRemoveLink(l.id)}
                    disabled={removingId === l.id}
                    title="Remove"
                    className="p-1.5 text-red-500 hover:bg-red-50 rounded disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
