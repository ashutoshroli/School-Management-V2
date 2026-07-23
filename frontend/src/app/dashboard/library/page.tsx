"use client";

import { useState, useEffect } from "react";
import { BookOpen, Plus, Search, RotateCcw, Trash2, Eye, Users, X, Briefcase, AlertTriangle, Percent, Settings } from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/hooks/useAuth";

/** Fine/lost-damage-cost waiver (spec Section 12) is restricted at the backend route level to SUPER_ADMIN/BRANCH_ADMIN/PRINCIPAL/VICE_PRINCIPAL - mirrored here purely to hide the button for roles that would get a 403 anyway. */
const WAIVE_ALLOWED_ROLES = ["SUPER_ADMIN", "BRANCH_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL"];

export default function LibraryPage() {
  const { canDelete, isAdmin } = usePermissions();
  const { user } = useAuth();
  const canWaive = !!user?.role && WAIVE_ALLOWED_ROLES.includes(user.role);
  // GET /library/config is ADMIN+LIBRARIAN; PUT is ADMIN only (see
  // facilities.routes.ts) - Librarians can view the branch's policy but
  // not change it.
  const canViewConfig = isAdmin || user?.role === "LIBRARIAN";

  const [tab, setTab] = useState<"books" | "issued" | "staffIssued">("books");
  const [books, setBooks] = useState<any[]>([]);
  const [issued, setIssued] = useState<any[]>([]);
  const [staffIssued, setStaffIssued] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [showModal, setShowModal] = useState(false);
  // Note: branchId is deliberately NOT part of this form - the backend
  // always scopes creation to the logged-in user's own branch.
  const [form, setForm] = useState({ title: "", author: "", isbn: "", publisher: "", category: "", rackNo: "", shelfNo: "", totalCopies: "1", price: "" });

  // View Details - drills into one book's full issue history via the
  // new getBookById endpoint (the list view only shows stock counts).
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // "Overdue only" toggle for the Issued Books / Staff Issued tabs -
  // previously impossible on the backend (getIssuedBooks had no such
  // filter).
  const [overdueOnly, setOverdueOnly] = useState(false);

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
        const res = await api.get("/facilities/library/books", { params: { search, category: categoryFilter || undefined } });
        setBooks(res.data.data || []);
      } else if (tab === "issued") {
        const res = await api.get("/facilities/library/issued", { params: { overdueOnly: overdueOnly ? "true" : undefined } });
        setIssued(res.data.data || []);
      } else {
        // Staff Issued (spec Section 12 - "Staff max 10 books at a
        // time") - previously had no listing UI at all even though
        // issueBookToStaff could create these rows.
        const res = await api.get("/facilities/library/issued/staff", { params: { overdueOnly: overdueOnly ? "true" : undefined } });
        setStaffIssued(res.data.data || []);
      }
    } catch {} finally { setLoading(false); }
  };
  useEffect(() => { fetch(); }, [tab, search, categoryFilter, overdueOnly]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/facilities/library/books", { ...form, totalCopies: parseInt(form.totalCopies), price: form.price ? parseFloat(form.price) : null });
      setShowModal(false);
      setForm({ title: "", author: "", isbn: "", publisher: "", category: "", rackNo: "", shelfNo: "", totalCopies: "1", price: "" });
      fetch();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  const returnBook = async (id: string) => {
    try {
      const res = await api.patch(`/facilities/library/return/${id}`);
      alert(res.data.message);
      fetch();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  const returnStaffBook = async (id: string) => {
    try {
      const res = await api.patch(`/facilities/library/return/staff/${id}`);
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

  // Mark a currently-issued copy LOST or DAMAGED (spec Section 12) -
  // works against either the student or staff issue table via
  // issueType, matching whichever tab the action was triggered from.
  const markLostOrDamaged = async (issueId: string, status: "LOST" | "DAMAGED", issueType: "STUDENT" | "STAFF") => {
    if (!confirm(`Mark this book copy as ${status.toLowerCase()}? This cannot be undone from here.`)) return;
    try {
      const res = await api.patch(`/facilities/library/issue/${issueId}/lost-damaged`, { status, issueType });
      alert(res.data.message);
      fetch();
    } catch (err: any) { alert(err.response?.data?.message || "Failed to mark lost/damaged"); }
  };

  // Bulk Issue - issue one book to a whole hand-picked list of
  // students at once (e.g. handing out the same textbook to an entire
  // class), via the new bulkIssueBook endpoint. Uses a simple
  // comma-separated admission-number lookup rather than a full
  // class/section picker, since library issuing is typically done from
  // a physical stack of ID cards / attendance sheet.
  const [bulkIssueBook, setBulkIssueBookTarget] = useState<any>(null);
  const [bulkStudentQuery, setBulkStudentQuery] = useState("");
  const [bulkSelectedStudents, setBulkSelectedStudents] = useState<any[]>([]);
  const [bulkStudentResults, setBulkStudentResults] = useState<any[]>([]);
  const [bulkDueDate, setBulkDueDate] = useState("");
  const [bulkIssuing, setBulkIssuing] = useState(false);
  const [bulkIssueResult, setBulkIssueResult] = useState<{ issued: number; skipped: number } | null>(null);

  const openBulkIssue = (book: any) => {
    setBulkIssueBookTarget(book);
    setBulkStudentQuery("");
    setBulkSelectedStudents([]);
    setBulkStudentResults([]);
    setBulkDueDate("");
    setBulkIssueResult(null);
  };

  useEffect(() => {
    if (!bulkStudentQuery.trim()) { setBulkStudentResults([]); return; }
    const timer = setTimeout(() => {
      api.get("/students", { params: { search: bulkStudentQuery, limit: 8 } })
        .then((res) => setBulkStudentResults(res.data.data || []))
        .catch(() => setBulkStudentResults([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [bulkStudentQuery]);

  const addBulkStudent = (student: any) => {
    if (!bulkSelectedStudents.some((s) => s.id === student.id)) {
      setBulkSelectedStudents((prev) => [...prev, student]);
    }
    setBulkStudentQuery("");
    setBulkStudentResults([]);
  };

  const handleBulkIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkIssueBook || bulkSelectedStudents.length === 0) return;
    setBulkIssuing(true);
    setBulkIssueResult(null);
    try {
      const res = await api.post("/facilities/library/issue/bulk", {
        bookId: bulkIssueBook.id,
        studentIds: bulkSelectedStudents.map((s) => s.id),
        dueDate: bulkDueDate,
      });
      setBulkIssueResult(res.data.data);
      fetch();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to bulk-issue book");
    } finally {
      setBulkIssuing(false);
    }
  };

  // Issue to Staff (spec Section 12 - "Staff max 10 books at a time")
  // - issueBookToStaff previously had no UI at all; only student
  // issuing (single + bulk) was reachable from this page.
  const [staffIssueBook, setStaffIssueBookTarget] = useState<any>(null);
  const [staffQuery, setStaffQuery] = useState("");
  const [staffResults, setStaffResults] = useState<any[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<any>(null);
  const [staffDueDate, setStaffDueDate] = useState("");
  const [staffIssuing, setStaffIssuing] = useState(false);

  const openStaffIssue = (book: any) => {
    setStaffIssueBookTarget(book);
    setStaffQuery("");
    setStaffResults([]);
    setSelectedStaff(null);
    setStaffDueDate("");
  };

  useEffect(() => {
    if (!staffQuery.trim() || selectedStaff) { setStaffResults([]); return; }
    const timer = setTimeout(() => {
      api.get("/staff", { params: { search: staffQuery, limit: 8 } })
        .then((res) => setStaffResults(res.data.data || []))
        .catch(() => setStaffResults([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [staffQuery, selectedStaff]);

  const handleIssueToStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staffIssueBook || !selectedStaff) return;
    setStaffIssuing(true);
    try {
      const res = await api.post("/facilities/library/issue/staff", {
        bookId: staffIssueBook.id,
        staffId: selectedStaff.id,
        dueDate: staffDueDate,
      });
      alert(res.data.message);
      setStaffIssueBookTarget(null);
      fetch();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to issue book to staff");
    } finally {
      setStaffIssuing(false);
    }
  };

  // Waive a fine or lost/damage cost (spec Section 12 - "Principal can
  // waive fully or partially, custom amount or %") - waiveLibraryCost
  // previously had no UI at all.
  const [waiveTarget, setWaiveTarget] = useState<{ issue: any; issueType: "STUDENT" | "STAFF" } | null>(null);
  const [waiveType, setWaiveType] = useState<"FINE" | "LOST_DAMAGE">("FINE");
  const [waiveAmount, setWaiveAmount] = useState("");
  const [waiveIsPercent, setWaiveIsPercent] = useState(false);
  const [waiving, setWaiving] = useState(false);

  const openWaiveModal = (issue: any, issueType: "STUDENT" | "STAFF") => {
    setWaiveTarget({ issue, issueType });
    setWaiveType(Number(issue.fine) > 0 ? "FINE" : "LOST_DAMAGE");
    setWaiveAmount("");
    setWaiveIsPercent(false);
  };

  const handleWaive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!waiveTarget) return;
    setWaiving(true);
    try {
      const res = await api.patch(`/facilities/library/issue/${waiveTarget.issue.id}/waive`, {
        waiveType,
        amount: parseFloat(waiveAmount),
        isPercent: waiveIsPercent,
        issueType: waiveTarget.issueType,
      });
      alert(res.data.message);
      setWaiveTarget(null);
      fetch();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to waive cost");
    } finally {
      setWaiving(false);
    }
  };

  // Library Config (spec Section 12 - Director-set fine/day, lost-
  // damage cost mode, issue limits) - getLibraryConfig/
  // upsertLibraryConfig previously had no UI at all, so a branch's
  // policy could only ever be the original hardcoded defaults (Rs
  // 2/day fine, no lost/damage cost, 3/10 issue limits).
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [configLoading, setConfigLoading] = useState(false);
  const [configForm, setConfigForm] = useState({
    finePerDay: "2", lostDamageCostMode: "FIXED",
    flatLostCost: "0", flatDamagedCost: "0",
    defaultLostCostPct: "0", defaultDamagedCostPct: "0",
    studentIssueLimit: "3", staffIssueLimit: "10",
  });
  const [savingConfig, setSavingConfig] = useState(false);

  const openConfigModal = async () => {
    setShowConfigModal(true);
    setConfigLoading(true);
    try {
      const res = await api.get("/facilities/library/config");
      const c = res.data.data;
      setConfigForm({
        finePerDay: String(c.finePerDay),
        lostDamageCostMode: c.lostDamageCostMode,
        flatLostCost: String(c.flatLostCost),
        flatDamagedCost: String(c.flatDamagedCost),
        defaultLostCostPct: String(c.defaultLostCostPct),
        defaultDamagedCostPct: String(c.defaultDamagedCostPct),
        studentIssueLimit: String(c.studentIssueLimit),
        staffIssueLimit: String(c.staffIssueLimit),
      });
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to load library config");
    } finally {
      setConfigLoading(false);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingConfig(true);
    try {
      await api.put("/facilities/library/config", {
        finePerDay: parseFloat(configForm.finePerDay),
        lostDamageCostMode: configForm.lostDamageCostMode,
        flatLostCost: parseFloat(configForm.flatLostCost),
        flatDamagedCost: parseFloat(configForm.flatDamagedCost),
        defaultLostCostPct: parseFloat(configForm.defaultLostCostPct),
        defaultDamagedCostPct: parseFloat(configForm.defaultDamagedCostPct),
        studentIssueLimit: parseInt(configForm.studentIssueLimit, 10),
        staffIssueLimit: parseInt(configForm.staffIssueLimit, 10),
      });
      setShowConfigModal(false);
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to save library config");
    } finally {
      setSavingConfig(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2"><BookOpen className="h-6 w-6 text-primary-600" /> Library</h1>
        <div className="flex items-center gap-2">
          {canViewConfig && (
            <button onClick={openConfigModal} className="btn-secondary flex items-center gap-2"><Settings className="h-4 w-4" /> Library Config</button>
          )}
          <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2"><Plus className="h-4 w-4" /> Add Book</button>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab("books")} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "books" ? "bg-primary-600 text-white" : "bg-gray-100"}`}>Books Catalog</button>
        <button onClick={() => setTab("issued")} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "issued" ? "bg-primary-600 text-white" : "bg-gray-100"}`}>Issued to Students</button>
        <button onClick={() => setTab("staffIssued")} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "staffIssued" ? "bg-primary-600 text-white" : "bg-gray-100"}`}>Issued to Staff</button>
      </div>

      {tab === "books" && (
        <div className="card mb-4 flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" /><input className="input-field pl-10" placeholder="Search by title, author, ISBN..." value={search} onChange={e => setSearch(e.target.value)} /></div>
          <input className="input-field w-auto" placeholder="Filter by category..." value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} />
        </div>
      )}
      {(tab === "issued" || tab === "staffIssued") && (
        <div className="card mb-4">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
            Show overdue only
          </label>
        </div>
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
                  <button onClick={() => openBulkIssue(b)} title="Bulk Issue to multiple students" className="text-primary-600 hover:text-primary-700 mr-3" disabled={b.availableCopies === 0}><Users className="h-4 w-4 inline" /></button>
                  <button onClick={() => openStaffIssue(b)} title="Issue to a staff member" className="text-primary-600 hover:text-primary-700 mr-3" disabled={b.availableCopies === 0}><Briefcase className="h-4 w-4 inline" /></button>
                  {canDelete && (
                    <button onClick={() => deleteBook(b.id, b.title)} className="text-red-500 hover:text-red-700"><Trash2 className="h-4 w-4 inline" /></button>
                  )}
                </td></tr>))}
            </tbody></table>
          </div>
        ) : tab === "issued" ? (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm"><thead><tr className="border-b bg-gray-50">
              <th className="px-4 py-3 text-left">Book</th><th className="px-4 py-3 text-left">Student</th><th className="px-4 py-3 text-left">Class</th>
              <th className="px-4 py-3 text-center">Fine</th><th className="px-4 py-3 text-center">Lost/Damage Cost</th><th className="px-4 py-3 text-center">Action</th>
            </tr></thead><tbody>
              {issued.map(i => (<tr key={i.id} className="border-b"><td className="px-4 py-3 font-medium">{i.book?.title}</td><td className="px-4 py-3">{i.student?.user?.name}</td><td className="px-4 py-3">{i.student?.class?.name}</td>
                <td className="px-4 py-3 text-center">{Number(i.fine) > 0 ? <span className="text-red-600 font-medium">Rs {i.fine}{Number(i.fineWaivedAmount) > 0 ? ` (waived Rs ${i.fineWaivedAmount})` : ""}</span> : "-"}</td>
                <td className="px-4 py-3 text-center">{Number(i.lostDamageCost) > 0 ? <span className="text-red-600 font-medium">Rs {i.lostDamageCost}{Number(i.lostDamageCostWaived) > 0 ? ` (waived Rs ${i.lostDamageCostWaived})` : ""}</span> : "-"}</td>
                <td className="px-4 py-3 text-center">
                  <div className="flex items-center justify-center gap-2 flex-wrap">
                    {i.status === "ISSUED" ? (
                      <>
                        <button onClick={() => returnBook(i.id)} className="text-xs text-primary-600 font-medium flex items-center gap-1"><RotateCcw className="h-3 w-3" /> Return</button>
                        <button onClick={() => markLostOrDamaged(i.id, "LOST", "STUDENT")} title="Mark Lost" className="text-xs text-red-600 font-medium flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Lost</button>
                        <button onClick={() => markLostOrDamaged(i.id, "DAMAGED", "STUDENT")} title="Mark Damaged" className="text-xs text-amber-600 font-medium">Damaged</button>
                      </>
                    ) : (
                      <span className="text-xs text-gray-400">{i.status}</span>
                    )}
                    {canWaive && (Number(i.fine) > 0 || Number(i.lostDamageCost) > 0) && (
                      <button onClick={() => openWaiveModal(i, "STUDENT")} title="Waive fine/cost" className="text-xs text-gray-600 font-medium flex items-center gap-1"><Percent className="h-3 w-3" /> Waive</button>
                    )}
                  </div>
                </td></tr>))}
              {issued.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No issued books found.</td></tr>}
            </tbody></table>
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm"><thead><tr className="border-b bg-gray-50">
              <th className="px-4 py-3 text-left">Book</th><th className="px-4 py-3 text-left">Staff</th><th className="px-4 py-3 text-left">Designation</th>
              <th className="px-4 py-3 text-center">Fine</th><th className="px-4 py-3 text-center">Lost/Damage Cost</th><th className="px-4 py-3 text-center">Action</th>
            </tr></thead><tbody>
              {staffIssued.map(i => (<tr key={i.id} className="border-b"><td className="px-4 py-3 font-medium">{i.book?.title}</td><td className="px-4 py-3">{i.staff?.user?.name || "-"}</td><td className="px-4 py-3">{i.staff?.designation || "-"}</td>
                <td className="px-4 py-3 text-center">{Number(i.fine) > 0 ? <span className="text-red-600 font-medium">Rs {i.fine}{Number(i.fineWaivedAmount) > 0 ? ` (waived Rs ${i.fineWaivedAmount})` : ""}</span> : "-"}</td>
                <td className="px-4 py-3 text-center">{Number(i.lostDamageCost) > 0 ? <span className="text-red-600 font-medium">Rs {i.lostDamageCost}{Number(i.lostDamageCostWaived) > 0 ? ` (waived Rs ${i.lostDamageCostWaived})` : ""}</span> : "-"}</td>
                <td className="px-4 py-3 text-center">
                  <div className="flex items-center justify-center gap-2 flex-wrap">
                    {i.status === "ISSUED" ? (
                      <>
                        <button onClick={() => returnStaffBook(i.id)} className="text-xs text-primary-600 font-medium flex items-center gap-1"><RotateCcw className="h-3 w-3" /> Return</button>
                        <button onClick={() => markLostOrDamaged(i.id, "LOST", "STAFF")} title="Mark Lost" className="text-xs text-red-600 font-medium flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Lost</button>
                        <button onClick={() => markLostOrDamaged(i.id, "DAMAGED", "STAFF")} title="Mark Damaged" className="text-xs text-amber-600 font-medium">Damaged</button>
                      </>
                    ) : (
                      <span className="text-xs text-gray-400">{i.status}</span>
                    )}
                    {canWaive && (Number(i.fine) > 0 || Number(i.lostDamageCost) > 0) && (
                      <button onClick={() => openWaiveModal(i, "STAFF")} title="Waive fine/cost" className="text-xs text-gray-600 font-medium flex items-center gap-1"><Percent className="h-3 w-3" /> Waive</button>
                    )}
                  </div>
                </td></tr>))}
              {staffIssued.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No staff-issued books found.</td></tr>}
            </tbody></table>
          </div>
        )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Add Book">
        <form onSubmit={handleAdd} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Title *</label><input className="input-field" value={form.title} onChange={e => setForm({...form, title: e.target.value})} required /></div>
            <div><label className="block text-sm font-medium mb-1">Author *</label><input className="input-field" value={form.author} onChange={e => setForm({...form, author: e.target.value})} required /></div>
            <div><label className="block text-sm font-medium mb-1">ISBN</label><input className="input-field" value={form.isbn} onChange={e => setForm({...form, isbn: e.target.value})} /></div>
            <div><label className="block text-sm font-medium mb-1">Publisher</label><input className="input-field" value={form.publisher} onChange={e => setForm({...form, publisher: e.target.value})} /></div>
            <div><label className="block text-sm font-medium mb-1">Category</label><input className="input-field" value={form.category} onChange={e => setForm({...form, category: e.target.value})} /></div>
            <div><label className="block text-sm font-medium mb-1">Total Copies</label><input type="number" min={1} className="input-field" value={form.totalCopies} onChange={e => setForm({...form, totalCopies: e.target.value})} /></div>
            <div><label className="block text-sm font-medium mb-1">Rack No</label><input className="input-field" value={form.rackNo} onChange={e => setForm({...form, rackNo: e.target.value})} /></div>
            <div><label className="block text-sm font-medium mb-1">Shelf No</label><input className="input-field" value={form.shelfNo} onChange={e => setForm({...form, shelfNo: e.target.value})} /></div>
            <div><label className="block text-sm font-medium mb-1">Price (Rs)</label><input type="number" step="0.01" min={0} className="input-field" value={form.price} onChange={e => setForm({...form, price: e.target.value})} placeholder="Purchase rate" /></div>
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
              <div><p className="text-gray-500">Publisher</p><p className="font-medium">{detail.publisher || "-"}</p></div>
              <div><p className="text-gray-500">Category</p><p className="font-medium">{detail.category || "-"}</p></div>
              <div><p className="text-gray-500">Rack / Shelf</p><p className="font-medium">{detail.rackNo || "-"} / {detail.shelfNo || "-"}</p></div>
              <div><p className="text-gray-500">Price</p><p className="font-medium">{detail.price ? `Rs ${detail.price}` : "-"}</p></div>
              <div><p className="text-gray-500">Available / Total</p><p className="font-medium">{detail.availableCopies} / {detail.totalCopies}</p></div>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-gray-600 mb-2">Issue History</h4>
              {detail.issues?.length > 0 ? (
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {detail.issues.map((iss: any) => (
                    <div key={iss.id} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded-lg text-sm">
                      <span>{iss.student?.user?.name} ({iss.student?.class?.name})</span>
                      <span className={`text-xs font-medium ${iss.status === "ISSUED" ? "text-amber-600" : iss.status === "RETURNED" ? "text-green-600" : "text-red-600"}`}>{iss.status}</span>
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

      <Modal isOpen={!!bulkIssueBook} onClose={() => setBulkIssueBookTarget(null)} title={bulkIssueBook ? `Bulk Issue - ${bulkIssueBook.title}` : "Bulk Issue"}>
        <form onSubmit={handleBulkIssue} className="space-y-4">
          <p className="text-xs text-gray-400">
            {bulkIssueBook?.availableCopies} copy/copies available. Issuance is capped at whatever's available even if
            you select more students.
          </p>
          {bulkIssueResult && (
            <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-3 py-2">
              Issued to {bulkIssueResult.issued} student(s){bulkIssueResult.skipped > 0 ? `, ${bulkIssueResult.skipped} skipped (not enough copies)` : ""}.
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">Add Students *</label>
            <input className="input-field" placeholder="Search by name or admission no..." value={bulkStudentQuery} onChange={(e) => setBulkStudentQuery(e.target.value)} />
            {bulkStudentResults.length > 0 && (
              <div className="border rounded-lg mt-1 max-h-40 overflow-y-auto">
                {bulkStudentResults.map((s: any) => (
                  <button type="button" key={s.id} onClick={() => addBulkStudent(s)} className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm border-b last:border-b-0">
                    {s.user?.name} ({s.admissionNo}) - {s.class?.name}-{s.section?.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          {bulkSelectedStudents.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {bulkSelectedStudents.map((s) => (
                <span key={s.id} className="flex items-center gap-1 text-xs px-2 py-1 bg-gray-100 rounded-full">
                  {s.user?.name}
                  <button type="button" onClick={() => setBulkSelectedStudents((prev) => prev.filter((x) => x.id !== s.id))}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">Due Date *</label>
            <input type="date" className="input-field" value={bulkDueDate} onChange={(e) => setBulkDueDate(e.target.value)} required />
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t">
            <button type="button" onClick={() => setBulkIssueBookTarget(null)} className="btn-secondary">Close</button>
            <button type="submit" disabled={bulkIssuing || bulkSelectedStudents.length === 0} className="btn-primary disabled:opacity-50">
              {bulkIssuing ? "Issuing..." : `Issue to ${bulkSelectedStudents.length} Student(s)`}
            </button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!staffIssueBook} onClose={() => setStaffIssueBookTarget(null)} title={staffIssueBook ? `Issue to Staff - ${staffIssueBook.title}` : "Issue to Staff"}>
        <form onSubmit={handleIssueToStaff} className="space-y-4">
          <p className="text-xs text-gray-400">{staffIssueBook?.availableCopies} copy/copies available.</p>
          <div>
            <label className="block text-sm font-medium mb-1">Staff Member *</label>
            {selectedStaff ? (
              <div className="flex items-center justify-between border rounded-lg px-3 py-2 text-sm">
                <span>{selectedStaff.user?.name} - {selectedStaff.designation || selectedStaff.employeeId}</span>
                <button type="button" onClick={() => setSelectedStaff(null)}><X className="h-4 w-4 text-gray-400" /></button>
              </div>
            ) : (
              <>
                <input className="input-field" placeholder="Search by name or employee ID..." value={staffQuery} onChange={(e) => setStaffQuery(e.target.value)} />
                {staffResults.length > 0 && (
                  <div className="border rounded-lg mt-1 max-h-40 overflow-y-auto">
                    {staffResults.map((s: any) => (
                      <button type="button" key={s.id} onClick={() => { setSelectedStaff(s); setStaffResults([]); }} className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm border-b last:border-b-0">
                        {s.user?.name} ({s.employeeId}) - {s.designation || "-"}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Due Date *</label>
            <input type="date" className="input-field" value={staffDueDate} onChange={(e) => setStaffDueDate(e.target.value)} required />
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t">
            <button type="button" onClick={() => setStaffIssueBookTarget(null)} className="btn-secondary">Close</button>
            <button type="submit" disabled={staffIssuing || !selectedStaff} className="btn-primary disabled:opacity-50">
              {staffIssuing ? "Issuing..." : "Issue Book"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!waiveTarget} onClose={() => setWaiveTarget(null)} title="Waive Fine / Lost-Damage Cost">
        <form onSubmit={handleWaive} className="space-y-4">
          <p className="text-xs text-gray-400">
            Fine: Rs {waiveTarget?.issue.fine || 0} &bull; Lost/Damage Cost: Rs {waiveTarget?.issue.lostDamageCost || 0}
          </p>
          <div>
            <label className="block text-sm font-medium mb-1">Waive *</label>
            <select className="input-field" value={waiveType} onChange={(e) => setWaiveType(e.target.value as "FINE" | "LOST_DAMAGE")}>
              <option value="FINE">Late-Return Fine</option>
              <option value="LOST_DAMAGE">Lost/Damage Cost</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Amount *</label>
              <input type="number" step="0.01" min={0} className="input-field" value={waiveAmount} onChange={(e) => setWaiveAmount(e.target.value)} required />
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input type="checkbox" checked={waiveIsPercent} onChange={(e) => setWaiveIsPercent(e.target.checked)} />
                As a percentage (%)
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t">
            <button type="button" onClick={() => setWaiveTarget(null)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={waiving} className="btn-primary disabled:opacity-50">{waiving ? "Waiving..." : "Waive"}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={showConfigModal} onClose={() => setShowConfigModal(false)} title="Library Config">
        {configLoading ? (
          <div className="flex justify-center py-8"><div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
        ) : (
          <form onSubmit={handleSaveConfig} className="space-y-4">
            <fieldset disabled={!isAdmin} className="space-y-4 disabled:opacity-60">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">Fine per Day (Rs) *</label><input type="number" step="0.01" min={0} className="input-field" value={configForm.finePerDay} onChange={(e) => setConfigForm({ ...configForm, finePerDay: e.target.value })} required /></div>
                <div>
                  <label className="block text-sm font-medium mb-1">Lost/Damage Cost Mode *</label>
                  <select className="input-field" value={configForm.lostDamageCostMode} onChange={(e) => setConfigForm({ ...configForm, lostDamageCostMode: e.target.value })}>
                    <option value="FIXED">Fixed (flat amount)</option>
                    <option value="PERCENTAGE">Percentage (of book rate)</option>
                  </select>
                </div>
              </div>
              {configForm.lostDamageCostMode === "FIXED" ? (
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-sm font-medium mb-1">Flat Lost Cost (Rs)</label><input type="number" step="0.01" min={0} className="input-field" value={configForm.flatLostCost} onChange={(e) => setConfigForm({ ...configForm, flatLostCost: e.target.value })} /></div>
                  <div><label className="block text-sm font-medium mb-1">Flat Damaged Cost (Rs)</label><input type="number" step="0.01" min={0} className="input-field" value={configForm.flatDamagedCost} onChange={(e) => setConfigForm({ ...configForm, flatDamagedCost: e.target.value })} /></div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-sm font-medium mb-1">Default Lost Cost (%)</label><input type="number" step="0.01" min={0} max={100} className="input-field" value={configForm.defaultLostCostPct} onChange={(e) => setConfigForm({ ...configForm, defaultLostCostPct: e.target.value })} /></div>
                  <div><label className="block text-sm font-medium mb-1">Default Damaged Cost (%)</label><input type="number" step="0.01" min={0} max={100} className="input-field" value={configForm.defaultDamagedCostPct} onChange={(e) => setConfigForm({ ...configForm, defaultDamagedCostPct: e.target.value })} /></div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">Student Issue Limit *</label><input type="number" min={1} className="input-field" value={configForm.studentIssueLimit} onChange={(e) => setConfigForm({ ...configForm, studentIssueLimit: e.target.value })} required /></div>
                <div><label className="block text-sm font-medium mb-1">Staff Issue Limit *</label><input type="number" min={1} className="input-field" value={configForm.staffIssueLimit} onChange={(e) => setConfigForm({ ...configForm, staffIssueLimit: e.target.value })} required /></div>
              </div>
            </fieldset>
            {!isAdmin && <p className="text-xs text-gray-400">Only a Branch/Super Admin can change these settings - you can view the current policy.</p>}
            <div className="flex justify-end gap-3 pt-2 border-t">
              <button type="button" onClick={() => setShowConfigModal(false)} className="btn-secondary">Close</button>
              {isAdmin && <button type="submit" disabled={savingConfig} className="btn-primary disabled:opacity-50">{savingConfig ? "Saving..." : "Save"}</button>}
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
