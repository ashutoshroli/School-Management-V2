"use client";

import { useState, useEffect } from "react";
import { TrendingUp, Search } from "lucide-react";
import api from "@/lib/api";

/**
 * Appraisal & Increment screen (spec Section 8) - raw data + average
 * per rating source (Student weekly, Parent post-PTM, Principal<->
 * Teacher mutual, VP<->Teacher mutual, Attendance performance), and
 * the Director's manually-entered increment %.
 */
export default function AppraisalPage() {
  const [staffId, setStaffId] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [incrementPct, setIncrementPct] = useState("");
  const [periodLabel, setPeriodLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    if (!staffId) return;
    setLoading(true);
    try {
      const res = await api.get(`/appraisal/increment-screen/${staffId}`);
      setData(res.data.data);
    } catch { setData(null); }
    finally { setLoading(false); }
  };

  const enterIncrement = async () => {
    if (!periodLabel || !incrementPct) { alert("Period label and increment % are required"); return; }
    setSaving(true);
    try {
      await api.post("/appraisal/increment", { staffId, periodLabel, incrementPct: Number(incrementPct), notes });
      fetchData();
      setIncrementPct(""); setNotes("");
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <TrendingUp className="h-6 w-6 text-primary-600" /> Appraisal & Increment
        </h1>
        <p className="text-gray-500 mt-1">5 rating sources feed the increment screen - Director manually enters the increment %, no auto-formula</p>
      </div>

      <div className="card mb-6 flex gap-3">
        <input className="input-field flex-1" placeholder="Staff ID" value={staffId} onChange={(e) => setStaffId(e.target.value)} />
        <button onClick={fetchData} className="btn-primary flex items-center gap-1.5 text-sm"><Search className="h-4 w-4" /> Load</button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-6">
            {data.bySource?.map((s: any) => (
              <div key={s.source} className="card text-center">
                <div className="text-xs text-gray-500 mb-1">{s.source.replace(/_/g, " ")}</div>
                <div className="text-xl font-bold text-primary-600">{s.averagePercent !== null ? `${s.averagePercent}%` : "N/A"}</div>
                <div className="text-xs text-gray-400">{s.count} rating(s)</div>
              </div>
            ))}
          </div>

          <div className="card mb-6">
            <h2 className="font-semibold text-gray-700 mb-3">Enter Increment %</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input className="input-field" placeholder="Period label e.g. 2026 Annual Review" value={periodLabel} onChange={(e) => setPeriodLabel(e.target.value)} />
              <input type="number" className="input-field" placeholder="Increment %" value={incrementPct} onChange={(e) => setIncrementPct(e.target.value)} />
              <input className="input-field" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <button onClick={enterIncrement} disabled={saving} className="btn-primary mt-3 disabled:opacity-50">{saving ? "Saving..." : "Save Increment"}</button>
          </div>

          <h2 className="font-semibold text-gray-700 mb-2">Prior Increments</h2>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="px-4 py-3 text-left">Period</th>
                  <th className="px-4 py-3 text-left">Increment %</th>
                  <th className="px-4 py-3 text-left">Notes</th>
                </tr>
              </thead>
              <tbody>
                {data.priorIncrements?.map((inc: any) => (
                  <tr key={inc.id} className="border-b">
                    <td className="px-4 py-3">{inc.periodLabel}</td>
                    <td className="px-4 py-3">{inc.incrementPct}%</td>
                    <td className="px-4 py-3">{inc.notes || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="card text-center py-12"><p className="text-gray-500">Enter a Staff ID and click Load to see their increment screen.</p></div>
      )}
    </div>
  );
}
