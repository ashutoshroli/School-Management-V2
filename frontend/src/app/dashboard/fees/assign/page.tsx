"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { UserCheck, Users, Search, CheckCircle2, Bus, MapPin } from "lucide-react";
import api from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

interface FeeStructure {
  id: string;
  classId: string | null;
  amount: number;
  frequency: string;
  feeCategory: { name: string; code: string };
  class: { name: string } | null;
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

interface TransportRoute {
  id: string;
  name: string;
  startPoint: string;
  endPoint: string;
  monthlyFee: number;
  _count?: { allocations: number };
}

function AssignFeesContent() {
  const searchParams = useSearchParams();
  const preselectedStructureId = searchParams.get("structureId");

  // Top-level choice: assign a class-wise fee structure, or a
  // transport route's fee to the students allocated to that route.
  // Routes are listed here too (not just on the Transport page) since
  // this is the single "Assign Fees" hub - a route with no
  // FeeStructure yet still shows up (assignTransportFee on the
  // backend creates one on first use), unlike the class-fee dropdown
  // below which only ever lists structures that already exist.
  const [feeType, setFeeType] = useState<"class" | "transport">("class");

  const [structures, setStructures] = useState<FeeStructure[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStructureId, setSelectedStructureId] = useState("");
  const [mode, setMode] = useState<"class" | "students">("class");
  const [resultMessage, setResultMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Transport route fee assignment state
  const [routes, setRoutes] = useState<TransportRoute[]>([]);
  const [years, setYears] = useState<any[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState("");
  const [selectedYearId, setSelectedYearId] = useState("");
  const [assigningTransport, setAssigningTransport] = useState(false);
  const [transportResult, setTransportResult] = useState<{ type: "success" | "error"; text: string } | null>(null);
  // "route" = every student currently allocated to the route (existing
  // bulk behavior). "students" = a hand-picked list, mirroring the
  // class-fee tab's Entire Class / Specific Students split.
  const [transportMode, setTransportMode] = useState<"route" | "students">("route");

  // Transport - specific students state. Unlike the class-fee picker,
  // this is NOT scoped to a class/section (a route's students can come
  // from any class) and deliberately doesn't require the student to
  // already be allocated to the route (see
  // assignTransportFeeToStudents's doc comment on the backend).
  const [transportSearch, setTransportSearch] = useState("");
  const [transportClassId, setTransportClassId] = useState("");
  const [transportSectionId, setTransportSectionId] = useState("");
  const [transportSearchResults, setTransportSearchResults] = useState<StudentOption[]>([]);
  const [transportSearchLoading, setTransportSearchLoading] = useState(false);
  const [selectedTransportStudentIds, setSelectedTransportStudentIds] = useState<Set<string>>(new Set());
  const [assigningTransportStudents, setAssigningTransportStudents] = useState(false);

  const transportSelectedClass = classes.find((c: any) => c.id === transportClassId) || null;
  const transportClassSections = transportSelectedClass?.sections || [];

  const selectedRoute = routes.find((r) => r.id === selectedRouteId) || null;

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
      const [sRes, cRes, rRes, yRes] = await Promise.all([
        api.get("/fees/structures"),
        api.get("/classes"),
        api.get("/facilities/transport/routes"),
        api.get("/academic-years"),
      ]);
      // The class-fee dropdown below only ever lists structures that
      // already exist (entire class/section or hand-picked students
      // within a class) - transport-route-wise structures (classId
      // null) are excluded here since they're handled by the separate
      // "Transport Route" tab, which lists routes directly instead.
      setStructures((sRes.data.data || []).filter((s: FeeStructure) => s.classId));
      setClasses(cRes.data.data || []);
      setRoutes(rRes.data.data || []);
      const yearList = yRes.data.data || [];
      setYears(yearList);
      const activeYear = yearList.find((y: any) => y.isActive);
      setSelectedYearId(activeYear?.id || yearList[0]?.id || "");
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

  useEffect(() => {
    setTransportResult(null);
    setTransportSearch("");
    setTransportClassId("");
    setTransportSectionId("");
    setTransportSearchResults([]);
    setSelectedTransportStudentIds(new Set());
    setTransportMode("route");
  }, [selectedRouteId]);

  // Class filter clears the section filter (same as the class-fee
  // tab) since sections belong to a specific class.
  useEffect(() => {
    setTransportSectionId("");
  }, [transportClassId]);

  // Re-run the search automatically when the class/section filter
  // changes (matches the class-fee tab's behavior on sectionId) - but
  // only once a class has actually been picked, otherwise every
  // keystroke-free page load would fire a search for "no filters" at
  // all.
  useEffect(() => {
    if (transportClassId) searchTransportStudents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transportClassId, transportSectionId]);

  const searchTransportStudents = async () => {
    // Unlike the class-fee tab's picker, a class/section filter here
    // is optional (not required) - a route's riders can come from any
    // class, so leaving both blank and just searching by name/
    // admission/roll across the whole branch is a valid way to use
    // this too.
    if (!transportSearch.trim() && !transportClassId) { setTransportSearchResults([]); return; }
    setTransportSearchLoading(true);
    try {
      const res = await api.get("/students", {
        params: {
          search: transportSearch || undefined,
          classId: transportClassId || undefined,
          sectionId: transportSectionId || undefined,
          limit: 50,
        },
      });
      setTransportSearchResults(res.data.data || []);
    } catch {
      setTransportSearchResults([]);
    } finally {
      setTransportSearchLoading(false);
    }
  };

  const toggleTransportStudentSelected = (id: string) => {
    setSelectedTransportStudentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

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

  const handleAssignTransportFee = async () => {
    if (!selectedRoute || !selectedYearId) return;
    setAssigningTransport(true);
    setTransportResult(null);
    try {
      const res = await api.post("/fees/assign/transport", {
        routeId: selectedRoute.id,
        academicYearId: selectedYearId,
      });
      setTransportResult({ type: "success", text: res.data.message || "Transport fee assigned." });
    } catch (err: any) {
      setTransportResult({ type: "error", text: err.response?.data?.message || "Failed to assign transport fee" });
    } finally {
      setAssigningTransport(false);
    }
  };

  const handleAssignTransportFeeToStudents = async () => {
    if (!selectedRoute || !selectedYearId || selectedTransportStudentIds.size === 0) return;
    setAssigningTransportStudents(true);
    setTransportResult(null);
    try {
      const res = await api.post("/fees/assign/transport/students", {
        routeId: selectedRoute.id,
        academicYearId: selectedYearId,
        studentIds: Array.from(selectedTransportStudentIds),
      });
      setTransportResult({ type: "success", text: res.data.message || "Transport fee assigned to selected students." });
      setSelectedTransportStudentIds(new Set());
    } catch (err: any) {
      setTransportResult({ type: "error", text: err.response?.data?.message || "Failed to assign transport fee to selected students" });
    } finally {
      setAssigningTransportStudents(false);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <UserCheck className="h-6 w-6 text-primary-600" /> Assign Fees
        </h1>
        <p className="text-gray-500 mt-1">Assign a class fee structure or a transport route's fee to students</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : (
        <div className="space-y-6">
          <div className="flex gap-2 border-b">
            <button
              onClick={() => setFeeType("class")}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 ${feeType === "class" ? "border-primary-600 text-primary-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}
            >
              <UserCheck className="h-4 w-4" /> Class Fee
            </button>
            <button
              onClick={() => setFeeType("transport")}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 ${feeType === "transport" ? "border-primary-600 text-primary-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}
            >
              <Bus className="h-4 w-4" /> Transport Route Fee
            </button>
          </div>

          {feeType === "transport" ? (
            <div className="space-y-6">
              <div className="card">
                <label className="block text-sm font-medium text-gray-700 mb-1">Transport Route *</label>
                <select
                  className="input-field max-w-xl"
                  value={selectedRouteId}
                  onChange={(e) => setSelectedRouteId(e.target.value)}
                >
                  <option value="">Select a route</option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.startPoint} → {r.endPoint}) - {formatCurrency(r.monthlyFee)}/month - {r._count?.allocations || 0} student(s) allocated
                    </option>
                  ))}
                </select>
                {routes.length === 0 && (
                  <p className="text-sm text-gray-500 mt-2">No transport routes found. Create one under Transport first.</p>
                )}
              </div>

              {selectedRoute && (
                <>
                  {transportResult && (
                    <div className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm ${transportResult.type === "success" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
                      {transportResult.type === "success" && <CheckCircle2 className="h-4 w-4 flex-shrink-0" />}
                      {transportResult.text}
                    </div>
                  )}

                  <div className="flex gap-2 border-b">
                    <button
                      onClick={() => setTransportMode("route")}
                      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 ${transportMode === "route" ? "border-primary-600 text-primary-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}
                    >
                      <Users className="h-4 w-4" /> Entire Route
                    </button>
                    <button
                      onClick={() => setTransportMode("students")}
                      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 ${transportMode === "students" ? "border-primary-600 text-primary-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}
                    >
                      <UserCheck className="h-4 w-4" /> Specific Students
                    </button>
                  </div>

                  {transportMode === "route" ? (
                    <div className="card space-y-4">
                      <p className="text-sm text-gray-600 flex items-start gap-2">
                        <MapPin className="h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5" />
                        This will assign a <span className="font-medium">Transport Fee</span> of{" "}
                        <span className="font-medium">{formatCurrency(selectedRoute.monthlyFee)}/month</span> to every one of the{" "}
                        <span className="font-medium">{selectedRoute._count?.allocations || 0} student(s)</span> currently allocated to this route.
                        Students who already have this fee assigned will be skipped automatically.
                      </p>

                      {!selectedRoute._count?.allocations && (
                        <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                          No students are allocated to this route yet - go to Transport &gt; Manage Students to allocate some, or use the "Specific Students" tab above to assign the fee directly.
                        </p>
                      )}

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Academic Year *</label>
                        <select className="input-field max-w-xl" value={selectedYearId} onChange={(e) => setSelectedYearId(e.target.value)}>
                          <option value="">Select</option>
                          {years.map((y: any) => <option key={y.id} value={y.id}>{y.name}</option>)}
                        </select>
                        {years.length === 0 && (
                          <p className="text-xs text-gray-500 mt-1">No academic years found. Create one under Academic Years first.</p>
                        )}
                      </div>

                      <button
                        onClick={handleAssignTransportFee}
                        disabled={assigningTransport || !selectedYearId || !selectedRoute._count?.allocations}
                        className="btn-primary disabled:opacity-50"
                      >
                        {assigningTransport ? "Assigning..." : "Assign Transport Fee"}
                      </button>
                    </div>
                  ) : (
                    <div className="card space-y-4">
                      <p className="text-sm text-gray-500">
                        Filter by class/section and/or search by name, admission no, or roll no, then tick the ones who should get this route's transport fee. Students don't need to already be allocated to this route.
                      </p>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Academic Year *</label>
                        <select className="input-field max-w-xl" value={selectedYearId} onChange={(e) => setSelectedYearId(e.target.value)}>
                          <option value="">Select</option>
                          {years.map((y: any) => <option key={y.id} value={y.id}>{y.name}</option>)}
                        </select>
                        {years.length === 0 && (
                          <p className="text-xs text-gray-500 mt-1">No academic years found. Create one under Academic Years first.</p>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-3">
                        <select className="input-field w-auto" value={transportClassId} onChange={(e) => setTransportClassId(e.target.value)}>
                          <option value="">All Classes</option>
                          {classes.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        <select
                          className="input-field w-auto"
                          value={transportSectionId}
                          onChange={(e) => setTransportSectionId(e.target.value)}
                          disabled={!transportClassId}
                        >
                          <option value="">All Sections</option>
                          {transportClassSections.map((sec: any) => <option key={sec.id} value={sec.id}>{sec.name}</option>)}
                        </select>
                        <div className="relative flex-1 min-w-[180px]">
                          <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                          <input
                            className="input-field pl-9 w-full"
                            placeholder="Search by name, admission no, roll no..."
                            value={transportSearch}
                            onChange={(e) => setTransportSearch(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && searchTransportStudents()}
                          />
                        </div>
                        <button type="button" onClick={searchTransportStudents} className="btn-secondary text-sm">Search</button>
                      </div>

                      <div className="border rounded-lg max-h-96 overflow-y-auto">
                        {transportSearchLoading ? (
                          <div className="flex justify-center py-8">
                            <div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" />
                          </div>
                        ) : transportSearchResults.length === 0 ? (
                          <p className="text-center text-gray-400 text-sm py-8">
                            {transportSearch.trim() || transportClassId ? "No students found" : "Search or filter by class above to select students"}
                          </p>
                        ) : (
                          <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-gray-50">
                              <tr className="border-b">
                                <th className="px-3 py-2 text-left w-10">
                                  <input
                                    type="checkbox"
                                    checked={transportSearchResults.length > 0 && transportSearchResults.every((s) => selectedTransportStudentIds.has(s.id))}
                                    onChange={() => {
                                      setSelectedTransportStudentIds((prev) => {
                                        const allVisibleSelected = transportSearchResults.every((s) => prev.has(s.id));
                                        const next = new Set(prev);
                                        if (allVisibleSelected) {
                                          transportSearchResults.forEach((s) => next.delete(s.id));
                                        } else {
                                          transportSearchResults.forEach((s) => next.add(s.id));
                                        }
                                        return next;
                                      });
                                    }}
                                  />
                                </th>
                                <th className="px-3 py-2 text-left">Admission No</th>
                                <th className="px-3 py-2 text-left">Name</th>
                                <th className="px-3 py-2 text-left">Class</th>
                                <th className="px-3 py-2 text-left">Section</th>
                                <th className="px-3 py-2 text-left">Roll No</th>
                              </tr>
                            </thead>
                            <tbody>
                              {transportSearchResults.map((s) => (
                                <tr
                                  key={s.id}
                                  onClick={() => toggleTransportStudentSelected(s.id)}
                                  className={`border-b cursor-pointer hover:bg-gray-50 ${selectedTransportStudentIds.has(s.id) ? "bg-primary-50" : ""}`}
                                >
                                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                                    <input type="checkbox" checked={selectedTransportStudentIds.has(s.id)} onChange={() => toggleTransportStudentSelected(s.id)} />
                                  </td>
                                  <td className="px-3 py-2 font-mono text-xs">{s.admissionNo}</td>
                                  <td className="px-3 py-2 font-medium">{s.user.name}</td>
                                  <td className="px-3 py-2 text-gray-500">{s.class?.name || "-"}</td>
                                  <td className="px-3 py-2 text-gray-500">{s.section?.name || "-"}</td>
                                  <td className="px-3 py-2 text-gray-500">{s.rollNo || "-"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t">
                        <span className="text-sm text-gray-500">{selectedTransportStudentIds.size} student(s) selected</span>
                        <button
                          type="button"
                          onClick={handleAssignTransportFeeToStudents}
                          disabled={selectedTransportStudentIds.size === 0 || !selectedYearId || assigningTransportStudents}
                          className="btn-primary disabled:opacity-50"
                        >
                          {assigningTransportStudents ? "Assigning..." : `Assign to ${selectedTransportStudentIds.size || ""} Student(s)`}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
          <>
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
                  {s.class?.name} - {s.feeCategory.name} - {formatCurrency(s.amount)} ({s.frequency}) - {s.academicYear.name}
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
                    This will assign <span className="font-medium">{selectedStructure.feeCategory.name}</span> ({formatCurrency(selectedStructure.amount)}, {selectedStructure.frequency}) to <span className="font-medium">every active student</span> in <span className="font-medium">{selectedStructure.class?.name}</span>. Students who already have this fee assigned will be skipped automatically.
                  </p>
                  <button onClick={handleAssignToClass} disabled={assigningClass} className="btn-primary disabled:opacity-50">
                    {assigningClass ? "Assigning..." : "Assign to Entire Class"}
                  </button>
                </div>
              ) : (
                <div className="card space-y-4">
                  <p className="text-sm text-gray-500">
                    Only students in <span className="font-medium">{selectedStructure.class?.name}</span> are shown - narrow down by section or search, then tick the students who should get this fee.
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
