"use client";

import { useState, useEffect } from "react";
import { Briefcase, Plus, Trash2, Users, Power } from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";
import { formatDate } from "@/lib/utils";

const EMPTY_FORM = { title: "", department: "", description: "", qualifications: "", closingDate: "" };

/**
 * Staff-side job vacancy management - create/edit/close vacancies and
 * review applications submitted through the public Careers page
 * (frontend/src/app/careers/page.tsx -> POST /public/jobs/:id/apply).
 * Mirrors the Admissions page's "staff reviews public submissions"
 * shape.
 */
export default function CareersManagementPage() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const [viewingApplicationsFor, setViewingApplicationsFor] = useState<any>(null);
  const [applications, setApplications] = useState<any[]>([]);
  const [loadingApplications, setLoadingApplications] = useState(false);

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const res = await api.get("/hr/jobs");
      setJobs(res.data.data || []);
    } catch {} finally { setLoading(false); }
  };
  useEffect(() => { fetchJobs(); }, []);

  const openCreateModal = () => {
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/hr/jobs", form);
      setShowModal(false);
      fetchJobs();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to post job vacancy");
    }
  };

  const toggleActive = async (job: any) => {
    try {
      await api.put(`/hr/jobs/${job.id}`, { isActive: !job.isActive });
      fetchJobs();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to update job vacancy");
    }
  };

  const handleDelete = async (job: any) => {
    if (!confirm(`Delete "${job.title}"?`)) return;
    try {
      await api.delete(`/hr/jobs/${job.id}`);
      fetchJobs();
    } catch (err: any) {
      alert(err.response?.data?.message || "Cannot delete this vacancy");
    }
  };

  const viewApplications = async (job: any) => {
    setViewingApplicationsFor(job);
    setLoadingApplications(true);
    try {
      const res = await api.get(`/hr/jobs/${job.id}/applications`);
      setApplications(res.data.data || []);
    } catch {
      setApplications([]);
    } finally {
      setLoadingApplications(false);
    }
  };

  const updateApplicationStatus = async (appId: string, status: string) => {
    try {
      await api.patch(`/hr/jobs/applications/${appId}/status`, { status });
      setApplications((prev) => prev.map((a) => (a.id === appId ? { ...a, status } : a)));
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to update application status");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Briefcase className="h-6 w-6 text-primary-600" /> Careers / Jobs</h1>
        <button onClick={openCreateModal} className="btn-primary flex items-center gap-2"><Plus className="h-4 w-4" /> Post Vacancy</button>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Postings marked active appear on the public Careers page for anyone to apply to, with no login required.
      </p>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-gray-50">
              <th className="px-4 py-3 text-left">Title</th>
              <th className="px-4 py-3 text-left">Department</th>
              <th className="px-4 py-3 text-left">Posted</th>
              <th className="px-4 py-3 text-left">Closing</th>
              <th className="px-4 py-3 text-center">Applications</th>
              <th className="px-4 py-3 text-center">Status</th>
              <th className="px-4 py-3 text-center">Actions</th>
            </tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-b">
                  <td className="px-4 py-3 font-medium">{j.title}</td>
                  <td className="px-4 py-3">{j.department || "-"}</td>
                  <td className="px-4 py-3 text-xs">{formatDate(j.postedAt)}</td>
                  <td className="px-4 py-3 text-xs">{j.closingDate ? formatDate(j.closingDate) : "No deadline"}</td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => viewApplications(j)} className="text-primary-600 hover:underline flex items-center gap-1 mx-auto">
                      <Users className="h-3.5 w-3.5" /> {j._count?.applications ?? 0}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${j.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                      {j.isActive ? "Open" : "Closed"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-3">
                      <button onClick={() => toggleActive(j)} title={j.isActive ? "Close vacancy" : "Reopen vacancy"} className="text-gray-500 hover:text-gray-700">
                        <Power className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => handleDelete(j)} title="Delete" className="text-red-500 hover:text-red-700">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {jobs.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No job vacancies posted yet</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Post Job Vacancy">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Title *</label>
            <input className="input-field" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Department</label>
            <input className="input-field" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description *</label>
            <textarea className="input-field" rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Qualifications</label>
            <textarea className="input-field" rows={2} value={form.qualifications} onChange={(e) => setForm({ ...form, qualifications: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Closing Date</label>
            <input type="date" className="input-field" value={form.closingDate} onChange={(e) => setForm({ ...form, closingDate: e.target.value })} />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">Post Vacancy</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!viewingApplicationsFor} onClose={() => setViewingApplicationsFor(null)} title={viewingApplicationsFor ? `Applications - ${viewingApplicationsFor.title}` : "Applications"} size="lg">
        {loadingApplications ? (
          <div className="flex justify-center py-8"><div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
        ) : applications.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No applications yet.</p>
        ) : (
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {applications.map((a) => (
              <div key={a.id} className="border rounded-lg p-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-sm">{a.applicantName}</p>
                    <p className="text-xs text-gray-500">{a.email} - {a.phone}</p>
                  </div>
                  <select
                    className="input-field text-xs w-auto py-1"
                    value={a.status}
                    onChange={(e) => updateApplicationStatus(a.id, e.target.value)}
                  >
                    <option value="NEW">New</option>
                    <option value="SHORTLISTED">Shortlisted</option>
                    <option value="REJECTED">Rejected</option>
                    <option value="HIRED">Hired</option>
                  </select>
                </div>
                {a.coverNote && <p className="text-xs text-gray-600 mt-2">{a.coverNote}</p>}
                {a.resumeUrl && (
                  <a href={a.resumeUrl} target="_blank" rel="noreferrer" className="text-xs text-primary-600 hover:underline mt-2 inline-block">
                    View Resume
                  </a>
                )}
                <p className="text-xs text-gray-400 mt-2">Applied {formatDate(a.createdAt)}</p>
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-end pt-4 border-t mt-4">
          <button type="button" onClick={() => setViewingApplicationsFor(null)} className="btn-secondary">Close</button>
        </div>
      </Modal>
    </div>
  );
}
