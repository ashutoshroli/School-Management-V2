"use client";

import { useState, useEffect } from "react";
import { Calendar } from "lucide-react";
import api from "@/lib/api";

const DAYS = ["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY"];
const PERIODS = [1,2,3,4,5,6,7,8];

export default function TimetablePage() {
  const [classes, setClasses] = useState<any[]>([]);
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [sections, setSections] = useState<any[]>([]);
  const [timetable, setTimetable] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.get("/classes").then(r => setClasses(r.data.data || [])); }, []);

  useEffect(() => {
    const cls = classes.find(c => c.id === classId);
    setSections(cls?.sections || []);
    setSectionId("");
  }, [classId, classes]);

  const fetchTimetable = async () => {
    if (!sectionId || !classId) return;
    setLoading(true);
    try {
      const years = await api.get("/academic-years");
      const activeYear = years.data.data?.find((y: any) => y.isActive);
      const res = await api.post("/academics/timetable", { sectionId, classId, academicYearId: activeYear?.id });
      setTimetable(res.data.data);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { if (sectionId) fetchTimetable(); }, [sectionId]);

  const getSlot = (day: string, period: number) => {
    return timetable?.slots?.find((s: any) => s.day === day && s.period === period);
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
      </div>

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
                      <td key={p} className={`border px-2 py-2 text-center ${slot?.isBreak ? "bg-yellow-50" : ""}`}>
                        {slot?.isBreak ? (
                          <span className="text-yellow-600 text-[10px]">BREAK</span>
                        ) : slot ? (
                          <div>
                            <p className="font-medium text-primary-700">{slot.subjectId?.slice(0,6) || "-"}</p>
                            <p className="text-[10px] text-gray-400">{slot.teacher?.user?.name?.split(" ")[0] || ""}</p>
                          </div>
                        ) : <span className="text-gray-300">-</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-gray-400 mt-3">Note: Use admin API to add/edit timetable slots. UI builder coming in future update.</p>
        </div>
      ) : sectionId ? <p className="text-center text-gray-500">No timetable found</p> : null}
    </div>
  );
}
