"use client";

import { useState, useEffect } from "react";
import { Users, UserCheck, Search, CheckCircle2, IndianRupee } from "lucide-react";
import api from "@/lib/api";

interface StaffOption {
  id: string;
  employeeId: string;
  designation: string;
  department: string;
  type: string;
  user: { name: string; email: string };
}

const TEMPLATE_DEFAULTS = {
  basic: "",
  da: "0",
  hra: "0",
  ta: "0",
  specialAllow: "0",
  medicalAllow: "0",
  otherAllow: "0",
  professionalTax: "200",
  otherDeduction: "0",
  taxRegime: "NEW" as "NEW" | "OLD",
};

/**
 * Bulk staff payment (salary structure) assignment - the payroll
 * counterpart to /dashboard/fees/assign for students. Lets an admin
 * define a single salary "template" (basic + allowances + deductions
 * + tax regime) and apply it to either:
 *   - every active staff member matching a type/department/designation
 *     filter (mirrors "Entire Class" on the fees page), or
 *   - a hand-picked list of staff, searched/selected individually
 *     (mirrors "Specific Students").
 * PF/ESI/TDS/gross/net are computed server-side per staff member from
 * the same template - see calculateSalaryStructure in
 * payroll.controller.ts.
 */
export default function BulkAssignSalaryPage() {
  const [mode, setMode] = useState<"filter" | "staff">("filter");
  const [template, setTemplate] = useState({ ...TEMPLATE_DEFAULTS });
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [resultMessage, setResultMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Filter-based assignment state
  const [type, setType] = useState("");
  const [department, setDepartment] = useState("");
  const [designation, setDesignation] = useState("");
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const [assigningFilter, setAssigningFilter] = useState(false);

  // Specific-staff assignment state
  const [search, setSearch] = useState("");
  const [searchType, setSearchType] = useState("");
  const [searchResults, setSearchResults] = useState<StaffOption[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedStaffIds, setSelectedStaffIds] = useState<Set<string>>(new Set());
  const [assigningStaff, setAssigningStaff] = useState(false);

  const templatePayload = () => {
    const payload: any = { overwriteExisting };
    Object.entries(template).forEach(([k, v]) => {
      payload[k] = k === "taxRegime" ? v : parseFloat(v as string) || 0;
    });
    return payload;
  };

  const isTemplateValid = template.basic.trim() !== "" && Number(template.basic) > 0;

  // Preview how many active staff currently match the filter, purely
  // informational (the actual filtering happens again server-side on
  // submit) - lets the admin see the blast radius before assigning.
  const previewMatchCount = async () => {
    setMatchLoading(true);
    try {
      const res = await api.get("/staff", {
        params: { type: type || undefined, department: department || undefined, limit: 1 },
      });
      // designation isn't a filter /staff supports server-side today,
      // so when it's set we can't get an exact count without fetching
      // everything - show the type/department-only count as an
      // approximation in that case instead of a wrong exact number.
      setMatchCount(res.data.pagination?.total ?? null);
    } catch {
      setMatchCount(null);
    } finally {
      setMatchLoading(false);
    }
  };

  useEffect(() => {
    previewMatchCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, department]);

  const handleAssignByFilter = async () => {
    if (!isTemplateValid) return;
    if (!confirm(`Assign this salary template to ${matchCount ?? "all matching"} active staff member(s)?`)) return;
    setAssigningFilter(true);
    setResultMessage(null);
    try {
      const res = await api.post("/hr/salary-structure/bulk", {
        type: type || undefined,
        department: department || undefined,
        designation: designation || undefined,
        ...templatePayload(),
      });
      setResultMessage({ type: "success", text: res.data.message || "Salary structure assigned." });
    } catch (err: any) {
      setResultMessage({ type: "error", text: err.response?.data?.message || "Failed to bulk-assign salary structure" });
    } finally {
      setAssigningFilter(false);
    }
  };

  const searchStaff = async () => {
    if (!search.trim() && !searchType) { setSearchResults([]); return; }
    setSearchLoading(true);
    try {
      const res = await api.get("/staff", {
        params: { search: search || undefined, type: searchType || undefined, limit: 50 },
      });
      setSearchResults(res.data.data || []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  };

  const toggleStaffSelected = (id: string) => {
    setSelectedStaffIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    setSelectedStaffIds((prev) => {
      const allVisibleSelected = searchResults.every((s) => prev.has(s.id));
      const next = new Set(prev);
      if (allVisibleSelected) {
        searchResults.forEach((s) => next.delete(s.id));
      } else {
        searchResults.forEach((s) => next.add(s.id));
      }
      return next;
    });
  };

  const handleAssignToStaff = async () => {
    if (!isTemplateValid || selectedStaffIds.size === 0) return;
    setAssigningStaff(true);
    setResultMessage(null);
    try {
      const res = await api.post("/hr/salary-structure/staff", {
        staffIds: Array.from(selectedStaffIds),
        ...templatePayload(),
      });
      setResultMessage({ type: "success", text: res.data.message || "Salary structure assigned to selected staff." });
      setSelectedStaffIds(new Set());
    } catch (err: any) {
      setResultMessage({ type: "error", text: err.response?.data?.message || "Failed to assign salary structure to selected staff" });
    } finally {
      setAssigningStaff(false);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <IndianRupee className="h-6 w-6 text-primary-600" /> Bulk Assign Salary
        </h1>
        <p className="text-gray-500 mt-1">
          Define a salary template once and apply it to a group of staff, or a hand-picked list. PF/ESI/TDS are
          auto-calculated per staff member, same as the single-staff Salary Structure page.
        </p>
      </div>

      <div className="card mb-6">
        <h3 className="font-semibold mb-4 text-green-700">Salary Template</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {(["basic", "da", "hra", "ta", "specialAllow", "medicalAllow", "otherAllow"] as const).map((k) => (
            <div key={k}>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                {k === "basic" ? "Basic *" : k}
              </label>
              <input
                type="number"
                className="input-field"
                value={template[k]}
                onChange={(e) => setTemplate({ ...template, [k]: e.target.value })}
              />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-4 mt-4">
          <div>
            <label className="block text-xs font-medium mb-1">Prof. Tax</label>
            <input
              type="number"
              className="input-field"
              value={template.professionalTax}
              onChange={(e) => setTemplate({ ...template, professionalTax: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Other Ded.</label>
            <input
              type="number"
              className="input-field"
              value={template.otherDeduction}
              onChange={(e) => setTemplate({ ...template, otherDeduction: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Tax Regime</label>
            <select
              className="input-field"
              value={template.taxRegime}
              onChange={(e) => setTemplate({ ...template, taxRegime: e.target.value as "NEW" | "OLD" })}
            >
              <option value="NEW">New</option>
              <option value="OLD">Old</option>
            </select>
          </div>
        </div>
        <label className="flex items-center gap-2 mt-4 text-sm text-gray-600">
          <input type="checkbox" checked={overwriteExisting} onChange={(e) => setOverwriteExisting(e.target.checked)} />
          Overwrite salary structure for staff who already have one (otherwise they're skipped)
        </label>
        {!isTemplateValid && (
          <p className="text-xs text-amber-600 mt-2">Enter a Basic salary greater than 0 to enable assignment below.</p>
        )}
      </div>

      {resultMessage && (
        <div
          className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm mb-6 ${
            resultMessage.type === "success"
              ? "bg-green-50 text-green-700 border border-green-200"
              : "bg-red-50 text-red-700 border border-red-200"
          }`}
        >
          {resultMessage.type === "success" && <CheckCircle2 className="h-4 w-4 flex-shrink-0" />}
          {resultMessage.text}
        </div>
      )}

      <div className="flex gap-2 border-b mb-6">
        <button
          onClick={() => setMode("filter")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 ${mode === "filter" ? "border-primary-600 text-primary-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}
        >
          <Users className="h-4 w-4" /> By Filter (Type/Department)
        </button>
        <button
          onClick={() => setMode("staff")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 ${mode === "staff" ? "border-primary-600 text-primary-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}
        >
          <UserCheck className="h-4 w-4" /> Specific Staff
        </button>
      </div>

      {mode === "filter" ? (
        <div className="card space-y-4">
          <p className="text-sm text-gray-600">
            Applies to every <span className="font-medium">active</span> staff member matching the filters below. Staff
            who already have a salary structure are skipped unless "Overwrite" is checked above.
          </p>

          <div className="flex flex-wrap gap-3">
            <select className="input-field w-auto" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All Types</option>
              <option value="TEACHING">Teaching</option>
              <option value="NON_TEACHING">Non-Teaching</option>
            </select>
            <input
              className="input-field w-auto"
              placeholder="Department (optional)"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            />
            <input
              className="input-field w-auto"
              placeholder="Designation (optional)"
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
            />
          </div>

          <p className="text-sm text-gray-500">
            {matchLoading
              ? "Checking how many staff match..."
              : matchCount !== null
              ? `Approximately ${matchCount} active staff member(s) match${designation ? " (before applying the designation filter)" : ""}.`
              : "Unable to preview match count."}
          </p>

          <button
            onClick={handleAssignByFilter}
            disabled={!isTemplateValid || assigningFilter}
            className="btn-primary disabled:opacity-50"
          >
            {assigningFilter ? "Assigning..." : "Assign to Matching Staff"}
          </button>
        </div>
      ) : (
        <div className="card space-y-4">
          <p className="text-sm text-gray-500">
            Search by name, email, employee ID, or designation, then tick the staff who should get this salary template.
          </p>

          <div className="flex flex-wrap gap-3">
            <select className="input-field w-auto" value={searchType} onChange={(e) => setSearchType(e.target.value)}>
              <option value="">All Types</option>
              <option value="TEACHING">Teaching</option>
              <option value="NON_TEACHING">Non-Teaching</option>
            </select>
            <div className="relative flex-1 min-w-[180px]">
              <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                className="input-field pl-9 w-full"
                placeholder="Search staff..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && searchStaff()}
              />
            </div>
            <button type="button" onClick={searchStaff} className="btn-secondary text-sm">
              Search
            </button>
          </div>

          <div className="border rounded-lg max-h-96 overflow-y-auto">
            {searchLoading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" />
              </div>
            ) : searchResults.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-8">
                {search.trim() || searchType ? "No staff found" : "Search or filter by type above to select staff"}
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50">
                  <tr className="border-b">
                    <th className="px-3 py-2 text-left w-10">
                      <input
                        type="checkbox"
                        checked={searchResults.length > 0 && searchResults.every((s) => selectedStaffIds.has(s.id))}
                        onChange={toggleSelectAllVisible}
                      />
                    </th>
                    <th className="px-3 py-2 text-left">Employee ID</th>
                    <th className="px-3 py-2 text-left">Name</th>
                    <th className="px-3 py-2 text-left">Designation</th>
                    <th className="px-3 py-2 text-left">Department</th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => toggleStaffSelected(s.id)}
                      className={`border-b cursor-pointer hover:bg-gray-50 ${selectedStaffIds.has(s.id) ? "bg-primary-50" : ""}`}
                    >
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selectedStaffIds.has(s.id)} onChange={() => toggleStaffSelected(s.id)} />
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{s.employeeId}</td>
                      <td className="px-3 py-2 font-medium">{s.user.name}</td>
                      <td className="px-3 py-2 text-gray-500">{s.designation}</td>
                      <td className="px-3 py-2 text-gray-500">{s.department}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="flex items-center justify-between pt-2 border-t">
            <span className="text-sm text-gray-500">{selectedStaffIds.size} staff member(s) selected</span>
            <button
              type="button"
              onClick={handleAssignToStaff}
              disabled={!isTemplateValid || selectedStaffIds.size === 0 || assigningStaff}
              className="btn-primary disabled:opacity-50"
            >
              {assigningStaff ? "Assigning..." : `Assign to ${selectedStaffIds.size || ""} Staff`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
