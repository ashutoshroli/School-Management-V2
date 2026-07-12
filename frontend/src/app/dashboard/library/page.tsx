"use client";

import { useState, useEffect } from "react";
import { BookOpen, Plus, Search, RotateCcw, Trash2, Eye } from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";
import DataTable from "@/components/ui/DataTable";

export default function LibraryPage() {
  const [tab, setTab] = useState<"books" | "issued">("books");
  const [books, setBooks] = useState<any[]>([]);
  const [issued, setIssued] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  // Note: branchId is deliberately NOT part of this form - the backend
  // always scopes creation to the logged-in user's own branch.
  const [form, setForm] = useState({ title: "", author: "", isbn: "", publisher: "", category: "", rackNo: "", totalCopies: "1", price: "" });

  // View Details - drills into one book's full issue history via the
  // new getBookById endpoint (the list view only shows stock counts).
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const openDetail = async (id: string) => {
    setDetail({});
    setDetailLoading(true);
    try {
      const res = await api.get(`/facilities/library/books/${id}`);
      setDetail(res.data.data);
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to load book details");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const fetch = async () => {
    setLoading(true);
    try {
      if (tab === "books") {
        const res = await api.get("/facilities/library/books", { params: { search } });
        setBooks(res.data.data || []);
      } else {
        const res = await api.get("/facilities/library/issued");
        setIssued(res.data.data || []);
      }
    } catch {} finally { setLoading(false); }
  };
  useEffect(() => { fetch(); }, [tab, search]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/facilities/library/books", { ...form, totalCopies: parseInt(form.totalCopies), price: form.price ? parseFloat(form.price) : null });
      setShowModal(false); fetch();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  const returnBook = async (id: string) => {
    try {
      const res = await api.patch(`/facilities/library/return/${id}`);
      alert(res.data.message);
      fetch();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  const deleteBook = async (id: string, title: string) => {
    if (!confirm(`Delete book "${title}"?`)) return;
    try {
      await api.delete(`/facilities/library/books/${id}`);
      fetch();
    } catch (err: any) { alert(err.response?.data?.message || "Cannot delete this book"); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2"><BookOpen className="h-6 w-6 text-primary-600" /> Library</h1>
        <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2"><Plus className="h-4 w-4" /> Add Book</button>
      </div>

      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab("books")} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "books" ? "bg-primary-600 text-white" : "bg-gray-100"}`}>Books Catalog</button>
        <button onClick={() => setTab("issued")} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "issued" ? "bg-primary-600 text-white" : "bg-gray-100"}`}>Issued Books</button>
      </div>

      {tab === "books" && (
        <div className="card mb-4"><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" /><input className="input-field pl-10" placeholder="Search by title, author, ISBN..." value={search} onChange={e => setSearch(e.target.value)} /></div></div>
      )}

      {loading ? <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div> :
        tab === "books" ? (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm"><thead><tr className="border-b bg-gray-50">
              <th className="px-4 py-3 text-left">Title</th><th className="px-4 py-3 text-left">Author</th>
              <th className="px-4 py-3 text-left">Category</th><th className="px-4 py-3 text-center">Available</th><th className="px-4 py-3 text-center">Total</th><th className="px-4 py-3 text-center">Actions</th>
            </tr></thead><tbody>
              {books.map(b => (<tr key={b.id} className="border-b"><td className="px-4 py-3 font-medium">{b.title}</td><td className="px-4 py-3">{b.author}</td><td className="px-4 py-3 text-xs">{b.category || "-"}</td><td className="px-4 py-3 text-center font-bold text-green-700">{b.availableCopies}</td><td className="px-4 py-3 text-center">{b.totalCopies}</td>
                <td className="px-4 py-3 text-center">
                  <button onClick={() => openDetail(b.id)} title="View Details" className="text-gray-500 hover:text-gray-700 mr-3"><Eye className="h-4 w-4 inline" /></button>
                  <button onClick={() => deleteBook(b.id, b.title)} className="text-red-500 hover:text-red-700"><Trash2 className="h-4 w-4 inline" /></button>
                </td></tr>))}
            </tbody></table>
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm"><thead><tr className="border-b bg-gray-50">
              <th className="px-4 py-3 text-left">Book</th><th className="px-4 py-3 text-left">Student</th><th className="px-4 py-3 text-left">Class</th><th className="px-4 py-3 text-center">Action</th>
            </tr></thead><tbody>
              {issued.map(i => (<tr key={i.id} className="border-b"><td className="px-4 py-3 font-medium">{i.book?.title}</td><td className="px-4 py-3">{i.student?.user?.name}</td><td className="px-4 py-3">{i.student?.class?.name}</td>
                <td className="px-4 py-3 text-center"><button onClick={() => returnBook(i.id)} className="text-xs text-primary-600 font-medium flex items-center gap-1 mx-auto"><RotateCcw className="h-3 w-3" /> Return</button></td></tr>))}
            </tbody></table>
          </div>
        )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Add Book">
        <form onSubmit={handleAdd} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Title *</label><input className="input-field" value={form.title} onChange={e => setForm({...form, title: e.target.value})} required /></div>
            <div><label className="block text-sm font-medium mb-1">Author *</label><input className="input-field" value={form.author} onChange={e => setForm({...form, author: e.target.value})} required /></div>
            <div><label className="block text-sm font-medium mb-1">ISBN</label><input className="input-field" value={form.isbn} onChange={e => setForm({...form, isbn: e.target.value})} /></div>
            <div><label className="block text-sm font-medium mb-1">Category</label><input className="input-field" value={form.category} onChange={e => setForm({...form, category: e.target.value})} /></div>
            <div><label className="block text-sm font-medium mb-1">Total Copies</label><input type="number" className="input-field" value={form.totalCopies} onChange={e => setForm({...form, totalCopies: e.target.value})} /></div>
            <div><label className="block text-sm font-medium mb-1">Rack/Shelf</label><input className="input-field" value={form.rackNo} onChange={e => setForm({...form, rackNo: e.target.value})} /></div>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t"><button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button><button type="submit" className="btn-primary">Add</button></div>
        </form>
      </Modal>

      <Modal isOpen={!!detail} onClose={() => setDetail(null)} title={detail?.title ? `Book - ${detail.title}` : "Book Details"}>
        {detailLoading ? (
          <div className="flex justify-center py-8"><div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
        ) : detail ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-gray-500">Author</p><p className="font-medium">{detail.author}</p></div>
              <div><p className="text-gray-500">ISBN</p><p className="font-medium">{detail.isbn || "-"}</p></div>
              <div><p className="text-gray-500">Category</p><p className="font-medium">{detail.category || "-"}</p></div>
              <div><p className="text-gray-500">Rack/Shelf</p><p className="font-medium">{detail.rackNo || "-"}</p></div>
              <div><p className="text-gray-500">Available / Total</p><p className="font-medium">{detail.availableCopies} / {detail.totalCopies}</p></div>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-gray-600 mb-2">Issue History</h4>
              {detail.issues?.length > 0 ? (
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {detail.issues.map((iss: any) => (
                    <div key={iss.id} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded-lg text-sm">
                      <span>{iss.student?.user?.name} ({iss.student?.class?.name})</span>
                      <span className={`text-xs font-medium ${iss.status === "ISSUED" ? "text-amber-600" : "text-green-600"}`}>{iss.status}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">No issue history yet.</p>
              )}
            </div>
            <div className="flex justify-end pt-2 border-t">
              <button type="button" onClick={() => setDetail(null)} className="btn-secondary">Close</button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
