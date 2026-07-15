"use client";

import { useEffect, useState } from "react";
import { Filter, X } from "lucide-react";
import api from "@/lib/api";

/**
 * Point 1 (Multi-Filter): a single combined filter bar - Class,
 * Section, Teacher, Subject - reused across Attendance, Marks,
 * Reports, Timetable, and the Student List instead of each page
 * having its own single-dropdown (usually just Class, sometimes
 * Class+Section) filter. All enabled filters apply together
 * (AND-combined) rather than one at a time.
 *
 * Usage:
 *   const [filters, setFilters] = useState<MultiFilterValue>({});
 *   <MultiFilterBar value={filters} onChange={setFilters} enable={["class","section","teacher","subject"]} />
 *   // then pass filters.classId / filters.sectionId / filters.teacherId / filters.subjectId to your API calls
 *
 * - Section options are automatically narrowed to the selected class's
 *   sections (fetched from the already-loaded class list - no extra
 *   request).
 * - Subject options are automatically narrowed to the selected class's
 *   assigned subjects (ClassSubject) once a class is chosen, via
 *   GET /classes/:classId/subjects - falls back to every branch
 *   subject when no class is selected yet (Point 11 pattern, reused
 *   here for consistency).
 * - Teacher options list TEACHING staff (GET /staff?type=TEACHING).
 * - A "Clear filters" button appears once any filter is active.
 */
export interface MultiFilterValue {
  classId?: string;
  sectionId?: string;
  teacherId?: string;
  subjectId?: string;
}

type FilterKey = "class" | "section" | "teacher" | "subject";

interface MultiFilterBarProps {
  value: MultiFilterValue;
  onChange: (next: MultiFilterValue) => void;
  /** Which filters to show, in order. Defaults to all four. */
  enable?: FilterKey[];
  className?: string;
}

interface ClassOption {
  id: string;
  name: string;
  sections?: { id: string; name: string }[];
}

export default function MultiFilterBar({ value, onChange, enable, className }: MultiFilterBarProps) {
  const enabled = new Set(enable && enable.length > 0 ? enable : ["class", "section", "teacher", "subject"]);

  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [teachers, setTeachers] = useState<any[]>([]);
  const [allSubjects, setAllSubjects] = useState<any[]>([]);
  const [classSubjects, setClassSubjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loads: Promise<any>[] = [api.get("/classes").then((r) => setClasses(r.data.data || []))];
    if (enabled.has("teacher")) {
      loads.push(api.get("/staff", { params: { type: "TEACHING", limit: 200 } }).then((r) => setTeachers(r.data.data || [])));
    }
    if (enabled.has("subject")) {
      loads.push(api.get("/classes/subjects").then((r) => setAllSubjects(r.data.data || [])));
    }
    Promise.all(loads).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Narrow Subject options to the selected class's assigned subjects
  // (Point 11 pattern) - falls back to every branch subject when no
  // class is selected, or when that class has no subjects assigned yet.
  useEffect(() => {
    if (!enabled.has("subject")) return;
    if (!value.classId) { setClassSubjects([]); return; }
    api
      .get(`/classes/${value.classId}/subjects`)
      .then((r) => setClassSubjects((r.data.data || []).map((cs: any) => cs.subject)))
      .catch(() => setClassSubjects([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.classId]);

  const selectedClass = classes.find((c) => c.id === value.classId);
  const sectionOptions = selectedClass?.sections || [];
  const subjectOptions = value.classId && classSubjects.length > 0 ? classSubjects : allSubjects;

  const set = (patch: Partial<MultiFilterValue>) => onChange({ ...value, ...patch });

  const handleClassChange = (classId: string) => {
    // Changing/clearing the class invalidates whatever section was
    // selected (it belonged to the OLD class's section list).
    onChange({ ...value, classId: classId || undefined, sectionId: undefined });
  };

  const hasActiveFilter = Boolean(value.classId || value.sectionId || value.teacherId || value.subjectId);

  const clearAll = () => onChange({});

  return (
    <div className={`card mb-4 ${className || ""}`}>
      <div className="flex items-center gap-2 mb-3 text-sm font-medium text-gray-600">
        <Filter className="h-4 w-4" /> Filters
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {enabled.has("class") && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Class</label>
            <select
              className="input-field w-auto"
              value={value.classId || ""}
              onChange={(e) => handleClassChange(e.target.value)}
              disabled={loading}
            >
              <option value="">All Classes</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

        {enabled.has("section") && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Section</label>
            <select
              className="input-field w-auto"
              value={value.sectionId || ""}
              onChange={(e) => set({ sectionId: e.target.value || undefined })}
              disabled={!value.classId || sectionOptions.length === 0}
              title={!value.classId ? "Select a class first" : undefined}
            >
              <option value="">All Sections</option>
              {sectionOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}

        {enabled.has("teacher") && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Teacher</label>
            <select
              className="input-field w-auto"
              value={value.teacherId || ""}
              onChange={(e) => set({ teacherId: e.target.value || undefined })}
              disabled={loading}
            >
              <option value="">All Teachers</option>
              {teachers.map((t) => <option key={t.id} value={t.id}>{t.user?.name}</option>)}
            </select>
          </div>
        )}

        {enabled.has("subject") && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Subject</label>
            <select
              className="input-field w-auto"
              value={value.subjectId || ""}
              onChange={(e) => set({ subjectId: e.target.value || undefined })}
              disabled={loading}
            >
              <option value="">All Subjects</option>
              {subjectOptions.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}

        {hasActiveFilter && (
          <button
            type="button"
            onClick={clearAll}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-600 px-2 py-2"
            title="Clear all filters"
          >
            <X className="h-3.5 w-3.5" /> Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
