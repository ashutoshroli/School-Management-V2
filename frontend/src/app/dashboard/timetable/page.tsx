"use client";

import { useState, useEffect } from "react";
import { Calendar, Trash2, Printer } from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";

const DAYS = ["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY"];
const PERIODS = [1,2,3,4,5,6,7,8];

export default function TimetablePage() {
  const [classes, setClasses] = useState<any[]>([]);
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [sections, setSections] = useState<any[]>([]);
  const [timetable, setTimetable] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [teachers, setTeachers] = useState<any[]>([]);
  const [error, setError] = useState("");

  // Consolidated "Full Class Timetable" view - shows every section of
  // the selected class stacked in one read-only, printable layout
  // (office notice board use case). Reuses the same
  // getOrCreateTimetable data per section, no new backend endpoint.
  const [showConsolidated, setShowConsolidated] = useState(false);
  const [consolidatedLoading, setConsolidatedLoading] = useState(false);
  const [consolidatedError, setConsolidatedError] = useState("");
  const [consolidatedData, setConsolidatedData] = useState<{ section: any; timetable: any }[]>([]);

  useEffect(() => {
    api.get("/classes").then(r => setClasses(r.data.data || []));
    api.get("/classes/subjects").then(r => setSubjects(r.data.data || []));
    // TEACHING staff only - a timetable slot assigns a teacher, not
    // any other staff role.
    api.get("/staff", { params: { type: "TEACHING", limit: 200 } }).then(r => setTeachers(r.data.data || []));
  }, []);

  useEffect(() => {
    const cls = classes.find(c => c.id === classId);
    setSections(cls?.sections || []);
    setSectionId("");
  }, [classId, classes]);

  const fetchTimetable = async () => {
    if (!sectionId || !classId) return;
    setLoading(true);
    setError("");
    setTimetable(null);
    try {
      const years = await api.get("/academic-years");
      const activeYear = years.data.data?.find((y: any) => y.isActive);
      if (!activeYear) {
        setError("No active academic year found. Set an academic year as active first (Dashboard > Academic Years).");
        return;
      }
      const res = await api.post("/academics/timetable", { sectionId, classId, academicYearId: activeYear.id });
      setTimetable(res.data.data);
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to load timetable");
    } finally { setLoading(false); }
  };

  useEffect(() => { if (sectionId) fetchTimetable(); }, [sectionId]);

  const getSlot = (day: string, period: number) => {
    return timetable?.slots?.find((s: any) => s.day === day && s.period === period);
  };

  // --- Slot editor modal ---
  const [showSlotModal, setShowSlotModal] = useState(false);
  const [slotDay, setSlotDay] = useState("");
  const [slotPeriod, setSlotPeriod] = useState(1);
  const [slotForm, setSlotForm] = useState({ subjectId: "", teacherId: "", startTime: "", endTime: "", isBreak: false });
  const [savingSlot, setSavingSlot] = useState(false);

  const openSlotEditor = (day: string, period: number) => {
    const existing = getSlot(day, period);
    setSlotDay(day);
    setSlotPeriod(period);
    setSlotForm({
      subjectId: existing?.subjectId || "",
      teacherId: existing?.teacherId || "",
      startTime: existing?.startTime || "",
      endTime: existing?.endTime || "",
      isBreak: existing?.isBreak || false,
    });
    setShowSlotModal(true);
  };

  const handleSaveSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSlot(true);
    try {
      await api.post("/academics/timetable/slot", {
        timetableId: timetable.id,
        day: slotDay,
        period: slotPeriod,
        subjectId: slotForm.isBreak ? null : slotForm.subjectId || null,
        teacherId: slotForm.isBreak ? null : slotForm.teacherId || null,
        startTime: slotForm.startTime,
        endTime: slotForm.endTime,
        isBreak: slotForm.isBreak,
      });
      setShowSlotModal(false);
      await fetchTimetable();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to save slot");
    } finally {
      setSavingSlot(false);
    }
  };

  const handleDeleteSlot = async () => {
    const existing = getSlot(slotDay, slotPeriod);
    if (!existing) { setShowSlotModal(false); return; }
    if (!confirm("Remove this slot?")) return;
    try {
      await api.delete(`/academics/timetable/slot/${existing.id}`);
      setShowSlotModal(false);
      await fetchTimetable();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to delete slot");
    }
  };

  const subjectName = (id: string) => subjects.find((s) => s.id === id)?.name || "-";

  const openConsolidatedView = async () => {
    if (!classId || sections.length === 0) return;
    setShowConsolidated(true);
    setConsolidatedLoading(true);
    setConsolidatedError("");
    setConsolidatedData([]);
    try {
      const years = await api.get("/academic-years");
      const activeYear = years.data.data?.find((y: any) => y.isActive);
      if (!activeYear) {
        setConsolidatedError("No active academic year found. Set an academic year as active first (Dashboard > Academic Years).");
        return;
      }
      const results = await Promise.all(
        sections.map(async (s: any) => {
          try {
            const res = await api.post("/academics/timetable", { sectionId: s.id, classId, academicYearId: activeYear.id });
            return { section: s, timetable: res.data.data };
          } catch {
            return { section: s, timetable: null };
          }
        })
      );
      setConsolidatedData(results);
    } catch (err: any) {
      setConsolidatedError(err.response?.data?.message || "Failed to load consolidated timetable");
    } finally {
      setConsolidatedLoading(false);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Calendar className="h-6 w-6 text-primary-600" /> Timetable</h1>
      </div>

      <div className="card mb-6 flex flex-wrap gap-4">
        <select className="input-field w-auto" value={classId} onChange={e => setClassId(e.target.value)}>
          <option value="">Select Class</option>
          {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="input-field w-auto" value={sectionId} onChange={e => setSectionId(e.target.value)}>
          <option value="">Section</option>
          {sections.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button
          type="button"
          onClick={openConsolidatedView}
          disabled={!classId || sections.length === 0}
          title={!classId ? "Select a class first" : "View all sections of this class in one printable layout"}
          className="btn-secondary text-sm flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Printer className="h-4 w-4" /> Full Class Timetable
        </button>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : timetable ? (
        <div className="card overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-50">
                <th className="border px-2 py-2 text-left">Day / Period</th>
                {PERIODS.map(p => <th key={p} className="border px-2 py-2 text-center">P{p}</th>)}
              </tr>
            </thead>
            <tbody>
              {DAYS.map(day => (
                <tr key={day}>
                  <td className="border px-2 py-2 font-medium bg-gray-50">{day.slice(0,3)}</td>
                  {PERIODS.map(p => {
                    const slot = getSlot(day, p);
                    return (
                      <td
                        key={p}
                        onClick={() => openSlotEditor(day, p)}
                        className={`border px-2 py-2 text-center cursor-pointer hover:bg-primary-50 ${slot?.isBreak ? "bg-yellow-50" : ""}`}
                        title="Click to add/edit this slot"
                      >
                        {slot?.isBreak ? (
                          <span className="text-yellow-600 text-[10px]">BREAK</span>
                        ) : slot ? (
                          <div>
                            <p className="font-medium text-primary-700">{subjectName(slot.subjectId)}</p>
                            <p className="text-[10px] text-gray-400">{slot.teacher?.user?.name?.split(" ")[0] || ""}</p>
                          </div>
                        ) : <span className="text-gray-300">+</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-gray-400 mt-3">Click any cell to add, edit, or remove that period&apos;s slot.</p>
        </div>
      ) : sectionId ? <p className="text-center text-gray-500">No timetable found</p> : null}

      <Modal
        isOpen={showSlotModal}
        onClose={() => setShowSlotModal(false)}
        title={`${slotDay ? slotDay.slice(0, 3) : ""} - Period ${slotPeriod}`}
      >
        <form onSubmit={handleSaveSlot} className="space-y-4">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isBreak"
              checked={slotForm.isBreak}
              onChange={(e) => setSlotForm({ ...slotForm, isBreak: e.target.checked })}
            />
            <label htmlFor="isBreak" className="text-sm font-medium">This is a break period</label>
          </div>

          {!slotForm.isBreak && (
            <>
              <div>
                <label className="block text-sm font-medium mb-1">Subject</label>
                <select className="input-field" value={slotForm.subjectId} onChange={(e) => setSlotForm({ ...slotForm, subjectId: e.target.value })}>
                  <option value="">Select</option>
                  {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Teacher</label>
                <select className="input-field" value={slotForm.teacherId} onChange={(e) => setSlotForm({ ...slotForm, teacherId: e.target.value })}>
                  <option value="">Select</option>
                  {teachers.map((t) => <option key={t.id} value={t.id}>{t.user?.name}</option>)}
                </select>
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Start Time</label>
              <input type="time" className="input-field" value={slotForm.startTime} onChange={(e) => setSlotForm({ ...slotForm, startTime: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">End Time</label>
              <input type="time" className="input-field" value={slotForm.endTime} onChange={(e) => setSlotForm({ ...slotForm, endTime: e.target.value })} />
            </div>
          </div>

          <div className="flex justify-between items-center gap-3 pt-4 border-t">
            {getSlot(slotDay, slotPeriod) ? (
              <button type="button" onClick={handleDeleteSlot} className="text-red-500 hover:text-red-700 flex items-center gap-1 text-sm">
                <Trash2 className="h-4 w-4" /> Remove Slot
              </button>
            ) : <span />}
            <div className="flex gap-3">
              <button type="button" onClick={() => setShowSlotModal(false)} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={savingSlot} className="btn-primary disabled:opacity-50">{savingSlot ? "Saving..." : "Save"}</button>
            </div>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={showConsolidated}
        onClose={() => setShowConsolidated(false)}
        title={`Full Class Timetable - ${classes.find((c) => c.id === classId)?.name || ""}`}
        size="xl"
      >
        <div className="print-timetable">
          {consolidatedError && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{consolidatedError}</div>
          )}
          {consolidatedLoading ? (
            <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
          ) : consolidatedData.length > 0 ? (
            <div className="space-y-6">
              {consolidatedData.map(({ section, timetable: tt }) => (
                <div key={section.id}>
                  <h4 className="font-semibold text-sm text-gray-800 mb-2">Section {section.name}</h4>
                  {tt ? (
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-gray-50">
                          <th className="border px-2 py-1.5 text-left">Day / Period</th>
                          {PERIODS.map((p) => <th key={p} className="border px-2 py-1.5 text-center">P{p}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {DAYS.map((day) => (
                          <tr key={day}>
                            <td className="border px-2 py-1.5 font-medium bg-gray-50">{day.slice(0, 3)}</td>
                            {PERIODS.map((p) => {
                              const slot = tt.slots?.find((s: any) => s.day === day && s.period === p);
                              return (
                                <td key={p} className={`border px-2 py-1.5 text-center ${slot?.isBreak ? "bg-yellow-50" : ""}`}>
                                  {slot?.isBreak ? (
                                    <span className="text-yellow-600 text-[10px]">BREAK</span>
                                  ) : slot ? (
                                    <div>
                                      <p className="font-medium text-primary-700">{subjectName(slot.subjectId)}</p>
                                      <p className="text-[10px] text-gray-400">{slot.teacher?.user?.name?.split(" ")[0] || ""}</p>
                                    </div>
                                  ) : (
                                    <span className="text-gray-300">-</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-sm text-gray-400">No timetable set for this section yet.</p>
                  )}
                </div>
              ))}
              <div className="flex justify-end pt-4 border-t print:hidden">
                <button type="button" onClick={() => window.print()} className="btn-secondary flex items-center gap-1.5">
                  <Printer className="h-4 w-4" /> Print
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400">No sections found for this class.</p>
          )}
        </div>
      </Modal>
    </div>
  );
}
