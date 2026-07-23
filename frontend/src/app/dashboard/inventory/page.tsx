"use client";

import { useState, useEffect } from "react";
import { Package, Plus, AlertTriangle, Trash2, Eye, ArrowRight, RotateCcw, ShieldAlert, ClipboardList } from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";
import { formatCurrency, formatDate } from "@/lib/utils";
import { usePermissions } from "@/hooks/usePermissions";

/** "expired" (red) / "expiring" (amber, within 30 days) / null (no date set / not due soon). */
function expiryStatus(date: string | null | undefined): "expired" | "expiring" | null {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const daysLeft = (d.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  if (daysLeft < 0) return "expired";
  if (daysLeft <= 30) return "expiring";
  return null;
}

function ExpiryBadge({ label, date }: { label: string; date: string | null | undefined }) {
  if (!date) return null;
  const status = expiryStatus(date);
  const styles = status === "expired" ? "bg-red-100 text-red-700" : status === "expiring" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${styles}`}>
      {status && <ShieldAlert className="h-3 w-3" />}
      {label}: {formatDate(date)}
    </span>
  );
}

const STAGE_LABELS: Record<string, string> = {
  INCHARGE_REQUESTED: "Awaiting Manager",
  MANAGER_APPROVED: "Awaiting Accounts",
  ACCOUNTS_APPROVED: "Awaiting Director",
  DIRECTOR_APPROVED: "Approved & Purchased",
  REJECTED: "Rejected",
};

export default function InventoryPage() {
  const { canDelete, isAdmin } = usePermissions();
  const [items, setItems] = useState<any[]>([]);
  const [lowStock, setLowStock] = useState<any[]>([]);
  // Appliance expiry alerts (spec Section 17 - "full auto-reminders/
  // alerts") - getApplianceExpiryAlerts existed with no UI at all
  // before this, same as the low-stock banner already has.
  const [applianceAlerts, setApplianceAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState<"item" | "purchase" | "issue">("item");
  const [form, setForm] = useState<any>({ name: "", category: "", unit: "pcs", minStock: "5" });
  const [dismissedLowStock, setDismissedLowStock] = useState(false);
  const [dismissedApplianceAlert, setDismissedApplianceAlert] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("");

  // View Details - drills into one item's purchase/issue history via
  // the new getItemById endpoint (the list view only shows counts).
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [returningIssueId, setReturningIssueId] = useState<string | null>(null);

  // Purchase Request (approval chain, spec Section 17) - raise +
  // list, mirroring the Diesel Requests page's Advance/Reject pattern.
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestForm, setRequestForm] = useState({ itemId: "", vendor: "", quantity: "", estimatedCost: "", reason: "" });
  const [raisingRequest, setRaisingRequest] = useState(false);
  const [showRequestsPanel, setShowRequestsPanel] = useState(false);
  const [purchaseRequests, setPurchaseRequests] = useState<any[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [advancingId, setAdvancingId] = useState<string | null>(null);

  const openDetail = async (id: string) => {
    setDetail({});
    setDetailLoading(true);
    try {
      const res = await api.get(`/facilities/inventory/items/${id}`);
      setDetail(res.data.data);
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to load item details");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshDetail = async (id: string) => {
    try {
      const res = await api.get(`/facilities/inventory/items/${id}`);
      setDetail(res.data.data);
    } catch {}
  };

  const markReturned = async (issueId: string, itemId: string) => {
    const returnCondition = prompt("Return condition (e.g. Good, Damaged, Needs Repair)? Leave blank if unknown.") || undefined;
    setReturningIssueId(issueId);
    try {
      const res = await api.patch(`/facilities/inventory/issue/${issueId}/return`, { returnCondition });
      alert(res.data.message);
      await refreshDetail(itemId);
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to mark as returned");
    } finally {
      setReturningIssueId(null);
    }
  };

  const fetch = async () => {
    setLoading(true);
    try {
      const [itemsRes, lowStockRes, applianceRes] = await Promise.all([
        api.get("/facilities/inventory/items", { params: { category: categoryFilter || undefined } }),
        api.get("/facilities/inventory/low-stock"),
        api.get("/facilities/inventory/appliance-alerts"),
      ]);
      setItems(itemsRes.data.data || []);
      setLowStock(lowStockRes.data.data || []);
      setApplianceAlerts(applianceRes.data.data || []);
    }
    catch {} finally { setLoading(false); }
  };
  useEffect(() => { fetch(); }, [categoryFilter]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (modalType === "item") {
        await api.post("/facilities/inventory/items", {
          ...form,
          minStock: parseInt(form.minStock),
          isAppliance: !!form.isAppliance,
          warrantyExpiry: form.isAppliance && form.warrantyExpiry ? form.warrantyExpiry : undefined,
          amcExpiry: form.isAppliance && form.amcExpiry ? form.amcExpiry : undefined,
        });
      }
      else if (modalType === "purchase") await api.post("/facilities/inventory/purchase", { ...form, quantity: parseInt(form.quantity), rate: parseFloat(form.rate) });
      else await api.post("/facilities/inventory/issue", { ...form, quantity: parseInt(form.quantity), isReturnable: !!form.isReturnable });
      setShowModal(false); fetch();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  const deleteItem = async (id: string, name: string) => {
    if (!confirm(`Delete item "${name}"? This will also remove its purchase/issue history.`)) return;
    try {
      await api.delete(`/facilities/inventory/items/${id}`);
      fetch();
    } catch (err: any) { alert(err.response?.data?.message || "Cannot delete this item"); }
  };

  const openModal = (type: "item" | "purchase" | "issue") => {
    setModalType(type);
    // Note: branchId is deliberately NOT part of this form - the
    // backend always scopes creation to the logged-in user's own branch.
    if (type === "item") setForm({ name: "", category: "", unit: "pcs", minStock: "5", rackNo: "", counterNo: "", isAppliance: false, warrantyExpiry: "", amcExpiry: "" });
    else if (type === "purchase") setForm({ itemId: "", vendor: "", quantity: "", rate: "", billNo: "" });
    else setForm({ itemId: "", issuedTo: "", quantity: "", purpose: "", isReturnable: false });
    setShowModal(true);
  };

  const openRequestModal = () => {
    setRequestForm({ itemId: "", vendor: "", quantity: "", estimatedCost: "", reason: "" });
    setShowRequestModal(true);
  };

  const handleRaiseRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setRaisingRequest(true);
    try {
      const res = await api.post("/facilities/inventory/purchase-requests", {
        ...requestForm,
        quantity: parseInt(requestForm.quantity, 10),
        estimatedCost: parseFloat(requestForm.estimatedCost),
      });
      alert(res.data.message);
      setShowRequestModal(false);
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to raise purchase request");
    } finally {
      setRaisingRequest(false);
    }
  };

  const openRequestsPanel = async () => {
    setShowRequestsPanel(true);
    setRequestsLoading(true);
    try {
      const res = await api.get("/facilities/inventory/purchase-requests");
      setPurchaseRequests(res.data.data || []);
    } catch {
      setPurchaseRequests([]);
    } finally {
      setRequestsLoading(false);
    }
  };

  const advanceRequest = async (id: string) => {
    setAdvancingId(id);
    try {
      const billNo = prompt("Bill No (optional, only used once fully approved)?") || undefined;
      const res = await api.patch(`/facilities/inventory/purchase-requests/${id}/advance`, { decision: "APPROVE", billNo });
      alert(res.data.message);
      await openRequestsPanel();
      fetch();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to advance request");
    } finally {
      setAdvancingId(null);
    }
  };

  const rejectRequest = async (id: string) => {
    const rejectionReason = prompt("Rejection reason?") || "";
    setAdvancingId(id);
    try {
      const res = await api.patch(`/facilities/inventory/purchase-requests/${id}/advance`, { decision: "REJECT", rejectionReason });
      alert(res.data.message);
      await openRequestsPanel();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to reject request");
    } finally {
      setAdvancingId(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Package className="h-6 w-6 text-primary-600" /> Inventory</h1>
        <div className="flex gap-2 flex-wrap">
          {isAdmin && (
            <button onClick={openRequestsPanel} className="btn-secondary text-sm flex items-center gap-2"><ClipboardList className="h-4 w-4" /> Purchase Requests</button>
          )}
          <button onClick={openRequestModal} className="btn-secondary text-sm">Raise Purchase Request</button>
          <button onClick={() => openModal("item")} className="btn-primary flex items-center gap-2"><Plus className="h-4 w-4" /> Add Item</button>
          <button onClick={() => openModal("purchase")} className="btn-secondary text-sm">Purchase</button>
          <button onClick={() => openModal("issue")} className="btn-secondary text-sm">Issue</button>
        </div>
      </div>

      <div className="card mb-4">
        <input className="input-field w-auto" placeholder="Filter by category..." value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} />
      </div>

      {!loading && lowStock.length > 0 && !dismissedLowStock && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-800">
                  {lowStock.length} item{lowStock.length > 1 ? "s are" : " is"} running low on stock
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {lowStock.map((i: any) => (
                    <span key={i.id} className="text-xs px-2 py-1 bg-white border border-amber-200 rounded-full text-amber-700">
                      {i.name}: {i.currentStock}/{i.minStock} {i.unit}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <button onClick={() => setDismissedLowStock(true)} className="text-amber-600 hover:text-amber-800 text-xs font-medium flex-shrink-0">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {!loading && applianceAlerts.length > 0 && !dismissedApplianceAlert && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <ShieldAlert className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-800">
                  {applianceAlerts.length} appliance{applianceAlerts.length > 1 ? "s have" : " has"} warranty/AMC expiring within 30 days (or already expired)
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {applianceAlerts.map((i: any) => (
                    <span key={i.id} className="text-xs px-2 py-1 bg-white border border-red-200 rounded-full text-red-700">
                      {i.name}: {i.warrantyExpiry ? `Warranty ${formatDate(i.warrantyExpiry)}` : ""}
                      {i.warrantyExpiry && i.amcExpiry ? " / " : ""}
                      {i.amcExpiry ? `AMC ${formatDate(i.amcExpiry)}` : ""}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <button onClick={() => setDismissedApplianceAlert(true)} className="text-red-600 hover:text-red-800 text-xs font-medium flex-shrink-0">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {loading ? <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm"><thead><tr className="border-b bg-gray-50">
            <th className="px-4 py-3 text-left">Item</th><th className="px-4 py-3 text-left">Category</th>
            <th className="px-4 py-3 text-left">Location</th>
            <th className="px-4 py-3 text-center">Stock</th><th className="px-4 py-3 text-center">Min</th><th className="px-4 py-3 text-center">Status</th><th className="px-4 py-3 text-center">Actions</th>
          </tr></thead><tbody>
            {items.map(i => (<tr key={i.id} className="border-b">
              <td className="px-4 py-3 font-medium">
                {i.name}
                {i.isAppliance && <span className="ml-2 text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-medium">Appliance</span>}
              </td>
              <td className="px-4 py-3 text-xs">{i.category}</td>
              <td className="px-4 py-3 text-xs text-gray-500">
                {i.rackNo || i.counterNo ? [i.rackNo && `Rack ${i.rackNo}`, i.counterNo && `Counter ${i.counterNo}`].filter(Boolean).join(" / ") : "-"}
              </td>
              <td className="px-4 py-3 text-center font-bold">{i.currentStock} {i.unit}</td>
              <td className="px-4 py-3 text-center text-gray-500">{i.minStock}</td>
              <td className="px-4 py-3 text-center">{i.currentStock <= i.minStock ? <span className="text-red-600 flex items-center justify-center gap-1"><AlertTriangle className="h-3 w-3" /> Low</span> : <span className="text-green-600">OK</span>}</td>
              <td className="px-4 py-3 text-center">
                <button onClick={() => openDetail(i.id)} title="View Details" className="text-gray-500 hover:text-gray-700 mr-3"><Eye className="h-4 w-4 inline" /></button>
                {canDelete && (
                  <button onClick={() => deleteItem(i.id, i.name)} className="text-red-500 hover:text-red-700"><Trash2 className="h-4 w-4 inline" /></button>
                )}
              </td>
            </tr>))}
          </tbody></table>
        </div>
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={modalType === "item" ? "Add Item" : modalType === "purchase" ? "Purchase Stock" : "Issue Stock"}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {modalType === "item" ? (<>
            <div><label className="block text-sm font-medium mb-1">Name *</label><input className="input-field" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required /></div>
            <div className="grid grid-cols-3 gap-4">
              <div><label className="block text-sm font-medium mb-1">Category</label><input className="input-field" value={form.category} onChange={e => setForm({...form, category: e.target.value})} /></div>
              <div><label className="block text-sm font-medium mb-1">Unit</label><input className="input-field" value={form.unit} onChange={e => setForm({...form, unit: e.target.value})} /></div>
              <div><label className="block text-sm font-medium mb-1">Min Stock</label><input type="number" className="input-field" value={form.minStock} onChange={e => setForm({...form, minStock: e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium mb-1">Rack No</label><input className="input-field" value={form.rackNo} onChange={e => setForm({...form, rackNo: e.target.value})} placeholder="e.g. R-12" /></div>
              <div><label className="block text-sm font-medium mb-1">Counter No</label><input className="input-field" value={form.counterNo} onChange={e => setForm({...form, counterNo: e.target.value})} placeholder="e.g. C-3" /></div>
            </div>
            <div className="pt-2 border-t">
              <label className="flex items-center gap-2 text-sm font-medium mb-2">
                <input type="checkbox" checked={!!form.isAppliance} onChange={(e) => setForm({ ...form, isAppliance: e.target.checked })} />
                This is a durable appliance/equipment item (enables warranty/AMC expiry tracking)
              </label>
              {form.isAppliance && (
                <div className="grid grid-cols-2 gap-4 mt-2">
                  <div><label className="block text-sm font-medium mb-1">Warranty Expiry</label><input type="date" className="input-field" value={form.warrantyExpiry} onChange={(e) => setForm({ ...form, warrantyExpiry: e.target.value })} /></div>
                  <div><label className="block text-sm font-medium mb-1">AMC Expiry</label><input type="date" className="input-field" value={form.amcExpiry} onChange={(e) => setForm({ ...form, amcExpiry: e.target.value })} /></div>
                </div>
              )}
            </div>
          </>) : modalType === "purchase" ? (<>
            <div><label className="block text-sm font-medium mb-1">Item *</label><select className="input-field" value={form.itemId} onChange={e => setForm({...form, itemId: e.target.value})} required><option value="">Select</option>{items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></div>
            <div className="grid grid-cols-3 gap-4">
              <div><label className="block text-sm font-medium mb-1">Qty *</label><input type="number" className="input-field" value={form.quantity} onChange={e => setForm({...form, quantity: e.target.value})} required /></div>
              <div><label className="block text-sm font-medium mb-1">Rate *</label><input type="number" className="input-field" value={form.rate} onChange={e => setForm({...form, rate: e.target.value})} required /></div>
              <div><label className="block text-sm font-medium mb-1">Vendor</label><input className="input-field" value={form.vendor} onChange={e => setForm({...form, vendor: e.target.value})} /></div>
            </div>
          </>) : (<>
            <div><label className="block text-sm font-medium mb-1">Item *</label><select className="input-field" value={form.itemId} onChange={e => setForm({...form, itemId: e.target.value})} required><option value="">Select</option>{items.map(i => <option key={i.id} value={i.id}>{i.name} ({i.currentStock})</option>)}</select></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium mb-1">Qty *</label><input type="number" className="input-field" value={form.quantity} onChange={e => setForm({...form, quantity: e.target.value})} required /></div>
              <div><label className="block text-sm font-medium mb-1">Issued To *</label><input className="input-field" value={form.issuedTo} onChange={e => setForm({...form, issuedTo: e.target.value})} required /></div>
            </div>
            <div><label className="block text-sm font-medium mb-1">Purpose</label><input className="input-field" value={form.purpose} onChange={e => setForm({...form, purpose: e.target.value})} /></div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!form.isReturnable} onChange={(e) => setForm({ ...form, isReturnable: e.target.checked })} />
              This item must be returned (e.g. a projector, sports equipment) - enables "Mark Returned" tracking
            </label>
          </>)}
          <div className="flex justify-end gap-3 pt-4 border-t"><button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button><button type="submit" className="btn-primary">Save</button></div>
        </form>
      </Modal>

      <Modal isOpen={!!detail} onClose={() => setDetail(null)} title={detail?.name ? `Item - ${detail.name}` : "Item Details"}>
        {detailLoading ? (
          <div className="flex justify-center py-8"><div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
        ) : detail ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div><p className="text-gray-500">Category</p><p className="font-medium">{detail.category || "-"}</p></div>
              <div><p className="text-gray-500">Current Stock</p><p className="font-medium">{detail.currentStock} {detail.unit}</p></div>
              <div><p className="text-gray-500">Min Stock</p><p className="font-medium">{detail.minStock}</p></div>
              <div><p className="text-gray-500">Rack No</p><p className="font-medium">{detail.rackNo || "-"}</p></div>
              <div><p className="text-gray-500">Counter No</p><p className="font-medium">{detail.counterNo || "-"}</p></div>
              <div><p className="text-gray-500">Appliance?</p><p className="font-medium">{detail.isAppliance ? "Yes" : "No"}</p></div>
            </div>
            {detail.isAppliance && (
              <div className="flex flex-wrap gap-2">
                <ExpiryBadge label="Warranty" date={detail.warrantyExpiry} />
                <ExpiryBadge label="AMC" date={detail.amcExpiry} />
                {!detail.warrantyExpiry && !detail.amcExpiry && <p className="text-sm text-gray-400">No warranty/AMC dates set.</p>}
              </div>
            )}
            <div>
              <h4 className="text-sm font-semibold text-gray-600 mb-2">Purchase History</h4>
              {detail.purchases?.length > 0 ? (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {detail.purchases.map((p: any) => (
                    <div key={p.id} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded-lg text-sm">
                      <span>{p.vendor || "-"}: {p.quantity} @ Rs {p.rate}</span>
                      <span className="text-xs text-gray-500">Rs {p.totalCost}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-gray-400">No purchases recorded yet.</p>}
            </div>
            <div>
              <h4 className="text-sm font-semibold text-gray-600 mb-2">Issue History</h4>
              {detail.issues?.length > 0 ? (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {detail.issues.map((iss: any) => (
                    <div key={iss.id} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded-lg text-sm">
                      <div>
                        <span>{iss.issuedTo}: {iss.quantity} {detail.unit}</span>
                        <p className="text-xs text-gray-500">{iss.purpose || "-"}</p>
                      </div>
                      {iss.isReturnable && (
                        iss.returnedAt ? (
                          <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                            <RotateCcw className="h-3 w-3" /> Returned {iss.returnCondition ? `(${iss.returnCondition})` : ""}
                          </span>
                        ) : (
                          <button
                            onClick={() => markReturned(iss.id, detail.id)}
                            disabled={returningIssueId === iss.id}
                            className="text-xs text-primary-600 font-medium flex items-center gap-1 disabled:opacity-50"
                          >
                            <RotateCcw className="h-3 w-3" /> {returningIssueId === iss.id ? "Marking..." : "Mark Returned"}
                          </button>
                        )
                      )}
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-gray-400">No issues recorded yet.</p>}
            </div>
            <div className="flex justify-end pt-2 border-t">
              <button type="button" onClick={() => setDetail(null)} className="btn-secondary">Close</button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal isOpen={showRequestModal} onClose={() => setShowRequestModal(false)} title="Raise Purchase Request">
        <form onSubmit={handleRaiseRequest} className="space-y-4">
          <p className="text-xs text-gray-400">
            Goes through the approval chain (Incharge -&gt; Manager -&gt; Accounts -&gt; Director) instead of applying to
            stock immediately - use the plain "Purchase" button above for small/no-approval-needed restocks.
          </p>
          <div>
            <label className="block text-sm font-medium mb-1">Item *</label>
            <select className="input-field" value={requestForm.itemId} onChange={(e) => setRequestForm({ ...requestForm, itemId: e.target.value })} required>
              <option value="">Select</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Vendor *</label><input className="input-field" value={requestForm.vendor} onChange={(e) => setRequestForm({ ...requestForm, vendor: e.target.value })} required /></div>
            <div><label className="block text-sm font-medium mb-1">Quantity *</label><input type="number" min={1} className="input-field" value={requestForm.quantity} onChange={(e) => setRequestForm({ ...requestForm, quantity: e.target.value })} required /></div>
          </div>
          <div><label className="block text-sm font-medium mb-1">Estimated Cost (Rs) *</label><input type="number" step="0.01" min={0} className="input-field" value={requestForm.estimatedCost} onChange={(e) => setRequestForm({ ...requestForm, estimatedCost: e.target.value })} required /></div>
          <div><label className="block text-sm font-medium mb-1">Reason</label><input className="input-field" value={requestForm.reason} onChange={(e) => setRequestForm({ ...requestForm, reason: e.target.value })} /></div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setShowRequestModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={raisingRequest} className="btn-primary disabled:opacity-50">{raisingRequest ? "Raising..." : "Raise Request"}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={showRequestsPanel} onClose={() => setShowRequestsPanel(false)} title="Purchase Requests" size="lg">
        <div className="space-y-2">
          {requestsLoading ? (
            <div className="flex justify-center py-8"><div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
          ) : purchaseRequests.length > 0 ? (
            <div className="max-h-96 overflow-y-auto space-y-2">
              {purchaseRequests.map((r: any) => (
                <div key={r.id} className="border rounded-lg p-3 flex items-center justify-between flex-wrap gap-2 text-sm">
                  <div>
                    <p className="font-medium">{r.item?.name} &bull; Qty {r.quantity} &bull; {formatCurrency(r.estimatedCost)}</p>
                    <p className="text-xs text-gray-500">Vendor: {r.vendor} &bull; {formatDate(r.createdAt)}{r.reason ? ` \u2022 ${r.reason}` : ""}</p>
                    {r.stage === "REJECTED" && r.rejectionReason && <p className="text-xs text-red-500 mt-0.5">Rejected: {r.rejectionReason}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${r.stage === "REJECTED" ? "bg-red-100 text-red-700" : r.stage === "DIRECTOR_APPROVED" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                      {STAGE_LABELS[r.stage] || r.stage}
                    </span>
                    {r.stage !== "DIRECTOR_APPROVED" && r.stage !== "REJECTED" && (
                      <>
                        <button onClick={() => advanceRequest(r.id)} disabled={advancingId === r.id} className="text-primary-600 hover:underline text-xs font-medium inline-flex items-center gap-1 disabled:opacity-50">
                          Advance <ArrowRight className="h-3 w-3" />
                        </button>
                        <button onClick={() => rejectRequest(r.id)} disabled={advancingId === r.id} className="text-red-600 hover:underline text-xs font-medium disabled:opacity-50">Reject</button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-6">No purchase requests found.</p>
          )}
          <div className="flex justify-end pt-4 border-t">
            <button type="button" onClick={() => setShowRequestsPanel(false)} className="btn-secondary">Close</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
