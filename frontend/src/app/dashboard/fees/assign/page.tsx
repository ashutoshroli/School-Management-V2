"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { UserCheck, Users, Search, CheckCircle2 } from "lucide-react";
import api from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

interface FeeStructure {
  id: string;
  classId: string;
  amount: number;
  frequency: string;
  feeCategory: { name: string; code: string };
  class: { name: string };
  academicYear: { name: string };
}

interface StudentOption {
  id: string;
  admissionNo: string;
  rollNo: string | null;
  user: { name: string };
  class: { name: string } | null;
  section: { name: string } | null;
}

function AssignFeesContent() {
  const searchParams = useSearchParams();
  const preselectedStructureId = searchParams.get("structureId");

  const [structures, setStructures] = useState<FeeStructure[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStructureId, setSelectedStructureId] = useState("");
  const [mode, setMode] = useState<"class" | "students">("class");
  const [resultMessage, setResultMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Whole-class assign state
  const [assigningClass, setAssigningClass] = useState(false);

  // Specific-students assign state
  const [sectionId, setSectionId] = useState("");
  const [search, setSearch] = useState("");
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
  const [assigningStudents, setAssigningStudents] = useState(false);

  const selectedStructure = structures.find((s) => s.id === selectedStructureId) || null;
  const selectedClass = selectedStructure ? classes.find((c: any) => c.id === selectedStructure.classId) : null;

  const fetchData = async () => {
    try {
      setLoading(true);
      const [sRes, cRes] = await Promise.all([
        api.get("/fees/structures"),
        api.get("/classes"),
      ]);
      setStructures(sRes.data.data || []);
      setClasses(cRes.data.data || []);
    } catch (err) {} finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  useEffect(() => {
    if (preselectedStructureId) setSelectedStructureId(preselectedStructureId);
  }, [preselectedStructureId]);

  // Reset the students picker whenever the chosen fee structure changes
  useEffect(() => {
    setSectionId("");
    setSearch("");
    setStudents([]);
    setSelectedStudentIds(new Set());
    setResultMessage(null);
  }, [selectedStructureId]);

  const fetchStudents = async () => {
    if (!selectedStructure) return;
    setStudentsLoading(true);
    try {
      const res = await api.get("/students", {
        params: {
          classId: selectedStructure.classId,
          sectionId: sectionId || undefined,
          search: search || undefined,
          limit: 100,
        },
      });
      setStudents(res.data.data || []);
    } catch {
      setStudents([]);
    } finally {
      setStudentsLoading(false);
    }
  };

  useEffect(() => {
    if (mode === "students" && selectedStructure) fetchStudents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selectedStructureId, sectionId]);

  const toggleStudentSelected = (id: string) => {
    setSelectedStudentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    setSelectedStudentIds((prev) => {
      const allVisibleSelected = students.every((s) => prev.has(s.id));
      const next = new Set(prev);
      if (allVisibleSelected) {
        students.forEach((s) => next.delete(s.id));
      } else {
        students.forEach((s) => next.add(s.id));
      }
      return next;
    });
  };

  const handleAssignToClass = async () => {
    if (!selectedStructure) return;
    if (!confirm("Assign this fee to ALL active students of this class?")) return;
    setAssigningClass(true);
    setResultMessage(null);
    try {
      const res = await api.post("/fees/assign/bulk", {
        feeStructureId: selectedStructure.id,
        classId: selectedStructure.classId,
      });
      setResultMessage({ type: "success", text: res.data.message || "Fee assigned to the class." });
    } catch (err: any) {
      setResultMessage({ type: "error", text: err.response?.data?.message || "Failed to assign fee to class" });
    } finally {
      setAssigningClass(false);
    }
  };

  const handleAssignToStudents = async () => {
    if (!selectedStructure || selectedStudentIds.size === 0) return;
    setAssigningStudents(true);
    setResultMessage(null);
    try {
      const res = await api.post("/fees/assign/students", {
        feeStructureId: selectedStructure.id,
        studentIds: Array.from(selectedStudentIds),
      });
      setResultMessage({ type: "success", text: res.data.message || "Fee assigned to selected students." });
      setSelectedStudentIds(new Set());
    } catch (err: any) {
      setResultMessage({ type: "error", text: err.response?.data?.message || "Failed to assign fee to selected students" });
    } finally {
      setAssigningStudents(false);
    }
  };

  const classSections = selectedClass?.sections || [];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <UserCheck className="h-6 w-6 text-primary-600" /> Assign Fees
        </h1>
        <p className="text-gray-500 mt-1">Assign a fee structure to an entire class or to specific students</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : (
        <div className="space-y-6">
          <div className="card">
            <label className="block text-sm font-medium text-gray-700 mb-1">Fee Structure *</label>
            <select
              className="input-field max-w-xl"
              value={selectedStructureId}
              onChange={(e) => setSelectedStructureId(e.target.value)}
            >
              <option value="">Select a fee structure</option>
              {structures.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.class.name} - {s.feeCategory.name} - {formatCurrency(s.amount)} ({s.frequency}) - {s.academicYear.name}
                </option>
              ))}
            </select>
            {structures.length === 0 && (
              <p className="text-sm text-gray-500 mt-2">No fee structures found. Create one under Fee Structures first.</p>
            )}
          </div>

          {selectedStructure && (
            <>
              {resultMessage && (
                <div className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm ${resultMessage.type === "success" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
                  {resultMessage.type === "success" && <CheckCircle2 className="h-4 w-4 flex-shrink-0" />}
                  {resultMessage.text}
                </div>
              )}

              <div className="flex gap-2 border-b">
                <button
                  onClick={() => setMode("class")}
                  className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 ${mode === "class" ? "border-primary-600 text-primary-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}
                >
                  <Users className="h-4 w-4" /> Entire Class
                </button>
                <button
                  onClick={() => setMode("students")}
                  className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 ${mode === "students" ? "border-primary-600 text-primary-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}
                >
                  <UserCheck className="h-4 w-4" /> Specific Students
                </button>
              </div>

              {mode === "class" ? (
                <div className="card">
                  <p className="text-sm text-gray-600 mb-4">
                    This will assign <span className="font-medium">{selectedStructure.feeCategory.name}</span> ({formatCurrency(selectedStructure.amount)}, {selectedStructure.frequency}) to <span className="font-medium">every active student</span> in <span className="font-medium">{selectedStructure.class.name}</span>. Students who already have this fee assigned will be skipped automatically.
                  </p>
                  <button onClick={handleAssignToClass} disabled={assigningClass} className="btn-primary disabled:opacity-50">
                    {assigningClass ? "Assigning..." : "Assign to Entire Class"}
                  </button>
                </div>
              ) : (
                <div className="card space-y-4">
                  <p className="text-sm text-gray-500">
                    Only students in <span className="font-medium">{selectedStructure.class.name}</span> are shown - narrow down by section or search, then tick the students who should get this fee.
                  </p>

                  <div className="flex flex-wrap gap-3">
                    <select className="input-field w-auto" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
                      <option value="">All Sections</option>
                      {classSections.map((sec: any) => <option key={sec.id} value={sec.id}>{sec.name}</option>)}
                    </select>
                    <div className="relative flex-1 min-w-[180px]">
                      <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        className="input-field pl-9 w-full"
                        placeholder="Search by name, admission no, roll no..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && fetchStudents()}
                      />
                    </div>
                    <button type="button" onClick={fetchStudents} className="btn-secondary text-sm">Search</button>
                  </div>

                  <div className="border rounded-lg max-h-96 overflow-y-auto">
                    {studentsLoading ? (
                      <div className="flex justify-center py-8">
                        <div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" />
                      </div>
                    ) : students.length === 0 ? (
                      <p className="text-center text-gray-400 text-sm py-8">No students found</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-gray-50">
                          <tr className="border-b">
                            <th className="px-3 py-2 text-left w-10">
                              <input
                                type="checkbox"
                                checked={students.length > 0 && students.every((s) => selectedStudentIds.has(s.id))}
                                onChange={toggleSelectAllVisible}
                              />
                            </th>
                            <th className="px-3 py-2 text-left">Admission No</th>
                            <th className="px-3 py-2 text-left">Name</th>
                            <th className="px-3 py-2 text-left">Section</th>
                            <th className="px-3 py-2 text-left">Roll No</th>
                          </tr>
                        </thead>
                        <tbody>
                          {students.map((s) => (
                            <tr
                              key={s.id}
                              onClick={() => toggleStudentSelected(s.id)}
                              className={`border-b cursor-pointer hover:bg-gray-50 ${selectedStudentIds.has(s.id) ? "bg-primary-50" : ""}`}
                            >
                              <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                                <input type="checkbox" checked={selectedStudentIds.has(s.id)} onChange={() => toggleStudentSelected(s.id)} />
                              </td>
                              <td className="px-3 py-2 font-mono text-xs">{s.admissionNo}</td>
                              <td className="px-3 py-2 font-medium">{s.user.name}</td>
                              <td className="px-3 py-2 text-gray-500">{s.section?.name || "-"}</td>
                              <td className="px-3 py-2 text-gray-500">{s.rollNo || "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t">
                    <span className="text-sm text-gray-500">{selectedStudentIds.size} student(s) selected</span>
                    <button
                      type="button"
                      onClick={handleAssignToStudents}
                      disabled={selectedStudentIds.size === 0 || assigningStudents}
                      className="btn-primary disabled:opacity-50"
                    >
                      {assigningStudents ? "Assigning..." : `Assign to ${selectedStudentIds.size || ""} Student(s)`}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function AssignFeesPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>}>
      <AssignFeesContent />
    </Suspense>
  );
}
