"use client";

import { useState, useEffect } from "react";
import { Clock, Plus, Save, Trash2 } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

interface PeriodConfigItem {
  periodNo: number;
  label: string;
  startTime: string;
  endTime: string;
  isBreak: boolean;
}

export default function PeriodConfigPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "SUPER_ADMIN" || user?.role === "BRANCH_ADMIN";

  const [periods, setPeriods] = useState<PeriodConfigItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    const fetchPeriods = async () => {
      setLoading(true);
      try {
        const res = await api.get("/academics/period-config", {
          params: { branchId: user?.branchId },
        });
        const data = res.data.data || [];
        if (data.length > 0) {
          setPeriods(data.map((p: any) => ({
            periodNo: p.periodNo,
            label: p.label || "",
            startTime: p.startTime,
            endTime: p.endTime,
            isBreak: p.isBreak,
          })));
        } else {
          // Default 8 periods
          setPeriods(getDefaultPeriods());
        }
      } catch {
        setPeriods(getDefaultPeriods());
      } finally {
        setLoading(false);
      }
    };
    fetchPeriods();
  }, [user?.branchId]);

  const getDefaultPeriods = (): PeriodConfigItem[] => [
    { periodNo: 1, label: "Period 1", startTime: "08:00", endTime: "08:45", isBreak: false },
    { periodNo: 2, label: "Period 2", startTime: "08:45", endTime: "09:30", isBreak: false },
    { periodNo: 3, label: "Period 3", startTime: "09:30", endTime: "10:15", isBreak: false },
    { periodNo: 4, label: "Short Break", startTime: "10:15", endTime: "10:30", isBreak: true },
    { periodNo: 5, label: "Period 4", startTime: "10:30", endTime: "11:15", isBreak: false },
    { periodNo: 6, label: "Period 5", startTime: "11:15", endTime: "12:00", isBreak: false },
    { periodNo: 7, label: "Lunch Break", startTime: "12:00", endTime: "12:45", isBreak: true },
    { periodNo: 8, label: "Period 6", startTime: "12:45", endTime: "13:30", isBreak: false },
  ];

  const addPeriod = () => {
    const nextNo = periods.length + 1;
    setPeriods([...periods, { periodNo: nextNo, label: `Period ${nextNo}`, startTime: "", endTime: "", isBreak: false }]);
  };

  const removePeriod = (index: number) => {
    const updated = periods.filter((_, i) => i !== index).map((p, i) => ({ ...p, periodNo: i + 1 }));
    setPeriods(updated);
  };

  const updatePeriod = (index: number, field: keyof PeriodConfigItem, value: any) => {
    const updated = [...periods];
    updated[index] = { ...updated[index], [field]: value };
    setPeriods(updated);
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await api.put("/academics/period-config", {
        branchId: user?.branchId,
        periods,
      });
      setMessage({ type: "success", text: "Period configuration saved successfully!" });
    } catch (err: any) {
      setMessage({ type: "error", text: err.response?.data?.message || "Failed to save period configuration." });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Clock className="h-6 w-6 text-primary-600" /> Period Configuration
          </h1>
          <p className="text-gray-500 mt-1">Define the daily period schedule for this branch</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <button onClick={addPeriod} className="btn-secondary flex items-center gap-1.5 text-sm">
              <Plus className="h-4 w-4" /> Add Period
            </button>
            <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-1.5 text-sm disabled:opacity-50">
              <Save className="h-4 w-4" /> {saving ? "Saving..." : "Save"}
            </button>
          </div>
        )}
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm border ${
          message.type === "success" ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"
        }`}>
          {message.text}
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="px-4 py-3 text-center w-16">#</th>
              <th className="px-4 py-3 text-left">Label</th>
              <th className="px-4 py-3 text-center">Start Time</th>
              <th className="px-4 py-3 text-center">End Time</th>
              <th className="px-4 py-3 text-center">Break?</th>
              {isAdmin && <th className="px-4 py-3 text-center w-16">Remove</th>}
            </tr>
          </thead>
          <tbody>
            {periods.map((p, i) => (
              <tr key={i} className={`border-b ${p.isBreak ? "bg-yellow-50" : ""}`}>
                <td className="px-4 py-3 text-center font-medium text-gray-500">{p.periodNo}</td>
                <td className="px-4 py-3">
                  <input
                    className="input-field"
                    value={p.label}
                    onChange={(e) => updatePeriod(i, "label", e.target.value)}
                    placeholder="e.g. Period 1"
                    disabled={!isAdmin}
                  />
                </td>
                <td className="px-4 py-3 text-center">
                  <input
                    type="time"
                    className="input-field text-center"
                    value={p.startTime}
                    onChange={(e) => updatePeriod(i, "startTime", e.target.value)}
                    disabled={!isAdmin}
                  />
                </td>
                <td className="px-4 py-3 text-center">
                  <input
                    type="time"
                    className="input-field text-center"
                    value={p.endTime}
                    onChange={(e) => updatePeriod(i, "endTime", e.target.value)}
                    disabled={!isAdmin}
                  />
                </td>
                <td className="px-4 py-3 text-center">
                  <input
                    type="checkbox"
                    checked={p.isBreak}
                    onChange={(e) => updatePeriod(i, "isBreak", e.target.checked)}
                    disabled={!isAdmin}
                  />
                </td>
                {isAdmin && (
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => removePeriod(i)} className="p-1.5 text-red-500 hover:bg-red-50 rounded">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
