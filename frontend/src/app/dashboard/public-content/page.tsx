"use client";

import { useState, useEffect } from "react";
import { Globe, Image as ImageIcon, FileText, MessageSquare, Trash2 } from "lucide-react";
import api from "@/lib/api";

/**
 * Staff-side management for the public landing page's Gallery,
 * Requirements page, and Feedback inbox (spec Section 21).
 */
export default function PublicContentPage() {
  const [tab, setTab] = useState<"gallery" | "requirements" | "feedback">("gallery");
  const [gallery, setGallery] = useState<any[]>([]);
  const [requirements, setRequirements] = useState({ content: "" });
  const [feedback, setFeedback] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newImage, setNewImage] = useState({ title: "", imageUrl: "", category: "" });

  const fetchTab = async () => {
    setLoading(true);
    try {
      if (tab === "gallery") setGallery((await api.get("/public-content/gallery")).data.data || []);
      if (tab === "requirements") setRequirements((await api.get("/public-content/requirements")).data.data || { content: "" });
      if (tab === "feedback") setFeedback((await api.get("/public-content/feedback")).data.data || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchTab(); }, [tab]);

  const addImage = async () => {
    if (!newImage.imageUrl) { alert("Image URL is required"); return; }
    try {
      await api.post("/public-content/gallery", newImage);
      setNewImage({ title: "", imageUrl: "", category: "" });
      fetchTab();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  const deleteImage = async (id: string) => {
    try { await api.delete(`/public-content/gallery/${id}`); fetchTab(); }
    catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  const saveRequirements = async () => {
    try {
      await api.put("/public-content/requirements", { content: requirements.content });
      alert("Saved");
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Globe className="h-6 w-6 text-primary-600" /> Public Landing Page Content
        </h1>
        <p className="text-gray-500 mt-1">Manage the Gallery, Requirements page, and Feedback inbox shown on the public website</p>
      </div>

      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab("gallery")} className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 ${tab === "gallery" ? "bg-primary-600 text-white" : "bg-gray-100 text-gray-600"}`}><ImageIcon className="h-4 w-4" /> Gallery</button>
        <button onClick={() => setTab("requirements")} className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 ${tab === "requirements" ? "bg-primary-600 text-white" : "bg-gray-100 text-gray-600"}`}><FileText className="h-4 w-4" /> Requirements</button>
        <button onClick={() => setTab("feedback")} className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 ${tab === "feedback" ? "bg-primary-600 text-white" : "bg-gray-100 text-gray-600"}`}><MessageSquare className="h-4 w-4" /> Feedback</button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : tab === "gallery" ? (
        <>
          <div className="card mb-6 grid grid-cols-1 md:grid-cols-4 gap-3">
            <input className="input-field" placeholder="Title" value={newImage.title} onChange={(e) => setNewImage({ ...newImage, title: e.target.value })} />
            <input className="input-field" placeholder="Image URL *" value={newImage.imageUrl} onChange={(e) => setNewImage({ ...newImage, imageUrl: e.target.value })} />
            <input className="input-field" placeholder="Category" value={newImage.category} onChange={(e) => setNewImage({ ...newImage, category: e.target.value })} />
            <button onClick={addImage} className="btn-primary">Add</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {gallery.map((g) => (
              <div key={g.id} className="card p-2">
                <img src={g.imageUrl} alt={g.title || ""} className="w-full h-32 object-cover rounded" />
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-gray-600">{g.title || g.category}</span>
                  <button onClick={() => deleteImage(g.id)} className="p-1 text-red-500 hover:bg-red-50 rounded"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : tab === "requirements" ? (
        <div className="card">
          <label className="block text-sm font-medium mb-2">Admission Eligibility / Document Requirements (HTML/Markdown)</label>
          <textarea
            className="input-field h-64"
            value={requirements.content}
            onChange={(e) => setRequirements({ ...requirements, content: e.target.value })}
          />
          <button onClick={saveRequirements} className="btn-primary mt-3">Save</button>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Email</th>
                <th className="px-4 py-3 text-left">Subject</th>
                <th className="px-4 py-3 text-left">Message</th>
              </tr>
            </thead>
            <tbody>
              {feedback.map((f) => (
                <tr key={f.id} className="border-b">
                  <td className="px-4 py-3">{f.name}</td>
                  <td className="px-4 py-3">{f.email}</td>
                  <td className="px-4 py-3">{f.subject || "-"}</td>
                  <td className="px-4 py-3 max-w-xs truncate">{f.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
