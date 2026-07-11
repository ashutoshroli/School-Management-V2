"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Calendar, Plus, Check, Trash2, Sparkles, ArrowRight, ArrowUpCircle, FileText } from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";
import ErrorBanner from "@/components/ui/ErrorBanner";
import { formatDate } from "@/lib/utils";

interface AcademicYear {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
}

export default function AcademicYearsPage() {
  const router = useRouter();
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  // "Start New Academic Year" rollover wizard - a guided sequence
  // chaining 3 already-existing flows (create year -> Student
  // Promotion -> Fee Structures) that today are 3 separate, easy-to-
  // forget manual steps. Pure frontend convenience: no new backend
  // endpoint, each step just calls/links to what already exists.
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [wizardYear, setWizardYear] = useState<AcademicYear | null>(null);
  const [wizardForm, setWizardForm] = useState({ name: "", startDate: "", endDate: "" });
  const [wizardCreating, setWizardCreating] = useState(false);
  const [wizardError, setWizardError] = useState("");
  // Note: branchId is deliberately NOT part of this form - the backend
  // always scopes creation to the logged-in user's own branch (see
  // resolveEffectiveBranchId in backend/src/utils/branchScope.ts). This
  // form previously sent an always-empty branchId field, which caused
  // every creation to fail (403/500) until that backend fallback was added.
  const [form, setForm] = useState({ name: "", startDate: "", endDate: "" });

  const [error, setError] = useState<string | null>(null);

  const fetchYears = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.get("/academic-years");
      setYears(res.data.data || []);
    } catch (err: any) {
      console.error("Failed to fetch academic years", err);
      setError(err.response?.data?.message || "Failed to load academic years. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchYears(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/academic-years", form);
      setShowModal(false);
      setForm({ name: "", startDate: "", endDate: "" });
      fetchYears();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to create");
    }
  };

  const setActive = async (id: string) => {
    try {
      await api.patch(`/academic-years/${id}/activate`);
      fetchYears();
    } catch (err) {
      alert("Failed to activate");
    }
  };

  const deleteYear = async (id: string, name: string) => {
    if (!confirm(`Delete academic year "${name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/academic-years/${id}`);
      fetchYears();
    } catch (err: any) {
      alert(err.response?.data?.message || "Cannot delete this academic year");
    }
  };

  const openWizard = () => {
    setWizardStep(1);
    setWizardYear(null);
    setWizardForm({ name: "", startDate: "", endDate: "" });
    setWizardError("");
    setShowWizard(true);
  };

  const handleWizardCreateYear = async (e: React.FormEvent) => {
    e.preventDefault();
    setWizardCreating(true);
    setWizardError("");
    try {
      const res = await api.post("/academic-years", wizardForm);
      const created = res.data.data as AcademicYear;
      // Setting the newly-created year active immediately, so the
      // Promotion page's "Academic Year" picker (which defaults to
      // whichever year is currently active) already points at it in
      // step 2 without the admin needing a separate detour back here.
      await api.patch(`/academic-years/${created.id}/activate`);
      setWizardYear({ ...created, isActive: true });
      await fetchYears();
      setWizardStep(2);
    } catch (err: any) {
      setWizardError(err.response?.data?.message || "Failed to create academic year");
    } finally {
      setWizardCreating(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Calendar className="h-6 w-6 text-primary-600" /> Academic Years
          </h1>
          <p className="text-gray-500 mt-1">Manage academic sessions</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={openWizard} className="btn-secondary flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Start New Academic Year
          </button>
          <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2">
            <Plus className="h-4 w-4" /> Add Year
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchYears} />}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-3 flex justify-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
          </div>
        ) : years.length === 0 ? (
          <p className="col-span-3 text-center text-gray-500 py-12">No academic years found</p>
        ) : (
          years.map((year) => (
            <div key={year.id} className={`card border-2 ${year.isActive ? "border-green-400" : "border-gray-100"}`}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-bold text-gray-900">{year.name}</h3>
                <div className="flex items-center gap-2">
                  {year.isActive && (
                    <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded-full">Active</span>
                  )}
                  <button onClick={() => deleteYear(year.id, year.name)} title="Delete" className="text-red-400 hover:text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <p className="text-sm text-gray-500">
                {formatDate(year.startDate)} — {formatDate(year.endDate)}
              </p>
              {!year.isActive && (
                <button onClick={() => setActive(year.id)} className="mt-3 text-sm text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1">
                  <Check className="h-4 w-4" /> Set as Active
                </button>
              )}
            </div>
          ))
        )}
      </div>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Create Academic Year">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Year Name *</label>
            <input className="input-field" placeholder="e.g., 2025-26" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Date *</label>
              <input type="date" className="input-field" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Date *</label>
              <input type="date" className="input-field" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} required />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">Create</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={showWizard} onClose={() => setShowWizard(false)} title="Start New Academic Year" size="lg">
        <div className="space-y-6">
          {/* Step indicator */}
          <div className="flex items-center justify-center gap-2 text-xs font-medium">
            {[
              { n: 1, label: "Create Year" },
              { n: 2, label: "Promote Students" },
              { n: 3, label: "Fee Structures" },
            ].map((s, i) => (
              <div key={s.n} className="flex items-center gap-2">
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full ${wizardStep === s.n ? "bg-primary-600 text-white" : wizardStep > s.n ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-400"}`}>
                  {wizardStep > s.n ? <Check className="h-3.5 w-3.5" /> : <span>{s.n}</span>}
                  {s.label}
                </div>
                {i < 2 && <ArrowRight className="h-3.5 w-3.5 text-gray-300" />}
              </div>
            ))}
          </div>

          {wizardError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{wizardError}</div>}

          {wizardStep === 1 && (
            <form onSubmit={handleWizardCreateYear} className="space-y-4">
              <p className="text-sm text-gray-500">
                Step 1 of 3: create the new academic year and set it active. This unlocks Promotion and Fee Structure
                setup for it.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Year Name *</label>
                <input className="input-field" placeholder="e.g., 2026-27" value={wizardForm.name} onChange={(e) => setWizardForm({ ...wizardForm, name: e.target.value })} required />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Date *</label>
                  <input type="date" className="input-field" value={wizardForm.startDate} onChange={(e) => setWizardForm({ ...wizardForm, startDate: e.target.value })} required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Date *</label>
                  <input type="date" className="input-field" value={wizardForm.endDate} onChange={(e) => setWizardForm({ ...wizardForm, endDate: e.target.value })} required />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2 border-t">
                <button type="button" onClick={() => setShowWizard(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={wizardCreating} className="btn-primary disabled:opacity-50">
                  {wizardCreating ? "Creating..." : "Create & Continue"}
                </button>
              </div>
            </form>
          )}

          {wizardStep === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">
                Step 2 of 3: <span className="font-medium text-gray-700">{wizardYear?.name}</span> is now active. Promote
                last year&apos;s students into their next class/section on the Promotion page (opens in this tab).
              </p>
              <button
                onClick={() => router.push("/dashboard/promotion")}
                className="w-full btn-secondary flex items-center justify-center gap-2 py-3"
              >
                <ArrowUpCircle className="h-4 w-4" /> Go to Student Promotion
              </button>
              <div className="flex justify-between pt-2 border-t">
                <button type="button" onClick={() => setWizardStep(1)} className="btn-secondary">Back</button>
                <button type="button" onClick={() => setWizardStep(3)} className="btn-primary">
                  I&apos;ve Promoted Students - Continue
                </button>
              </div>
            </div>
          )}

          {wizardStep === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">
                Step 3 of 3: set up fee structures for <span className="font-medium text-gray-700">{wizardYear?.name}</span>{" "}
                so fees can be assigned/collected once students are in their new classes.
              </p>
              <button
                onClick={() => router.push("/dashboard/fees/structures")}
                className="w-full btn-secondary flex items-center justify-center gap-2 py-3"
              >
                <FileText className="h-4 w-4" /> Go to Fee Structures
              </button>
              <div className="flex justify-between pt-2 border-t">
                <button type="button" onClick={() => setWizardStep(2)} className="btn-secondary">Back</button>
                <button type="button" onClick={() => setShowWizard(false)} className="btn-primary flex items-center gap-1.5">
                  <Check className="h-4 w-4" /> Done
                </button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
