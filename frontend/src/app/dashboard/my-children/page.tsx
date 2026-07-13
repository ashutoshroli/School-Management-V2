"use client";

import { useState, useEffect } from "react";
import { Users, GraduationCap, IndianRupee, ClipboardCheck, FileText } from "lucide-react";
import api from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";


export default function MyChildrenPage() {
  const [children, setChildren] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedChild, setSelectedChild] = useState<string>("");
  const [summary, setSummary] = useState<any>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      try {
        const res = await api.get("/parent/children");
        const data = res.data.data || [];
        setChildren(data);
        if (data.length > 0) setSelectedChild(data[0].id);
      } catch { setChildren([]); }
      finally { setLoading(false); }
    };
    fetch();
  }, []);

  useEffect(() => {
    if (!selectedChild) { setSummary(null); return; }
    const fetchSummary = async () => {
      setSummaryLoading(true);
      try {
        const res = await api.get(`/parent/children/${selectedChild}/summary`);
        setSummary(res.data.data);
      } catch { setSummary(null); }
      finally { setSummaryLoading(false); }
    };
    fetchSummary();
  }, [selectedChild]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Users className="h-6 w-6 text-primary-600" /> My Children
        </h1>
        <p className="text-gray-500 mt-1">Overview of your child&apos;s academic progress</p>
      </div>

      {children.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-500">No children linked to your account.</p>
        </div>
      ) : (
        <>
          {children.length > 1 && (
            <div className="mb-4">
              <select className="input-field w-auto" value={selectedChild} onChange={(e) => setSelectedChild(e.target.value)}>
                {children.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.user?.name} - {c.class?.name} {c.section?.name}</option>
                ))}
              </select>
            </div>
          )}

          {summaryLoading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
            </div>
          ) : summary ? (
            <div className="space-y-6">
              {/* Quick Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="card text-center">
                  <ClipboardCheck className="h-6 w-6 text-blue-600 mx-auto mb-2" />
                  <p className="text-2xl font-bold">{summary.attendance?.percentage?.toFixed(1) || 0}%</p>
                  <p className="text-xs text-gray-500">Attendance</p>
                </div>
                <div className="card text-center">
                  <IndianRupee className="h-6 w-6 text-green-600 mx-auto mb-2" />
                  <p className="text-2xl font-bold">{formatCurrency(summary.fees?.paid || 0)}</p>
                  <p className="text-xs text-gray-500">Fees Paid</p>
                </div>
                <div className="card text-center">
                  <IndianRupee className="h-6 w-6 text-red-600 mx-auto mb-2" />
                  <p className="text-2xl font-bold">{formatCurrency(summary.fees?.pending || 0)}</p>
                  <p className="text-xs text-gray-500">Fees Pending</p>
                </div>
                <div className="card text-center">
                  <FileText className="h-6 w-6 text-purple-600 mx-auto mb-2" />
                  <p className="text-2xl font-bold">{summary.exams?.count || 0}</p>
                  <p className="text-xs text-gray-500">Exams Taken</p>
                </div>
              </div>

              {/* Recent Exams */}
              {summary.exams?.recent && summary.exams.recent.length > 0 && (
                <div className="card">
                  <h3 className="font-semibold mb-3 flex items-center gap-2">
                    <GraduationCap className="h-5 w-5 text-primary-600" /> Recent Exam Results
                  </h3>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-gray-50">
                        <th className="px-4 py-2 text-left">Exam</th>
                        <th className="px-4 py-2 text-center">Subject</th>
                        <th className="px-4 py-2 text-center">Marks</th>
                        <th className="px-4 py-2 text-center">Grade</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.exams.recent.map((r: any, i: number) => (
                        <tr key={i} className="border-b">
                          <td className="px-4 py-2">{r.examName}</td>
                          <td className="px-4 py-2 text-center">{r.subject}</td>
                          <td className="px-4 py-2 text-center font-medium">{r.obtained}/{r.max}</td>
                          <td className="px-4 py-2 text-center">{r.grade || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
