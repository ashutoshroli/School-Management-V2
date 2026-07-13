"use client";

import { useState, useEffect } from "react";
import { Database, Play, Trash2, AlertTriangle, CheckCircle2 } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";


export default function DemoDataPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "SUPER_ADMIN";

  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await api.get("/demo-data/status");
      setStatus(res.data.data);
    } catch { setStatus(null); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchStatus(); }, []);

  const handleSeed = async () => {
    if (!confirm("This will create a complete demo organization with branches, classes, staff, students, etc. Continue?")) return;
    setActing("seed");
    setMessage(null);
    try {
      const res = await api.post("/demo-data/seed");
      setMessage({ type: "success", text: res.data.message || "Demo data seeded successfully!" });
      fetchStatus();
    } catch (err: any) {
      setMessage({ type: "error", text: err.response?.data?.message || "Failed to seed demo data" });
    } finally { setActing(null); }
  };

  const handleRemove = async () => {
    if (!confirm("WARNING: This will PERMANENTLY DELETE all demo data including the demo branch. Are you sure?")) return;
    setActing("remove");
    setMessage(null);
    try {
      const res = await api.post("/demo-data/remove");
      setMessage({ type: "success", text: res.data.message || "Demo data removed successfully!" });
      fetchStatus();
    } catch (err: any) {
      setMessage({ type: "error", text: err.response?.data?.message || "Failed to remove demo data" });
    } finally { setActing(null); }
  };

  const handleGenerate = async () => {
    if (!confirm("Generate realistic transactional data (attendance, fees, payments, etc.) for the current branch?")) return;
    setActing("generate");
    setMessage(null);
    try {
      const res = await api.post("/demo-data/generate", { branchId: user?.branchId });
      setMessage({ type: "success", text: res.data.message || "Transactional demo data generated!" });
    } catch (err: any) {
      setMessage({ type: "error", text: err.response?.data?.message || "Failed to generate data" });
    } finally { setActing(null); }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Database className="h-6 w-6 text-primary-600" /> Demo Data Management
        </h1>
        <p className="text-gray-500 mt-1">Seed or remove demo data for testing and demonstrations</p>
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm border flex items-center gap-2 ${
          message.type === "success" ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"
        }`}>
          {message.type === "success" ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          {message.text}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {isSuperAdmin && (
            <>
              <div className="card">
                <h3 className="font-semibold text-lg mb-2">Seed Demo Organization</h3>
                <p className="text-sm text-gray-500 mb-4">
                  Creates a complete demo setup: organization, branch, classes, sections, subjects, staff, and students.
                </p>
                {status?.seeded && (
                  <p className="text-xs text-green-600 mb-3 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Demo data already exists
                  </p>
                )}
                <button onClick={handleSeed} disabled={!!acting} className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50">
                  <Play className="h-4 w-4" /> {acting === "seed" ? "Seeding..." : "Seed Demo Data"}
                </button>
              </div>

              <div className="card border-red-200">
                <h3 className="font-semibold text-lg mb-2 text-red-700">Remove Demo Data</h3>
                <p className="text-sm text-gray-500 mb-4">
                  Permanently deletes all demo organization data. This action cannot be undone.
                </p>
                <button onClick={handleRemove} disabled={!!acting} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
                  <Trash2 className="h-4 w-4" /> {acting === "remove" ? "Removing..." : "Remove Demo Data"}
                </button>
              </div>
            </>
          )}

          <div className="card">
            <h3 className="font-semibold text-lg mb-2">Generate Transactional Data</h3>
            <p className="text-sm text-gray-500 mb-4">
              Generates realistic attendance records, fee payments, exam marks, etc. for the current branch.
            </p>
            <button onClick={handleGenerate} disabled={!!acting} className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50">
              <Play className="h-4 w-4" /> {acting === "generate" ? "Generating..." : "Generate Data"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
