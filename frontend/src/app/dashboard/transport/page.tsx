"use client";

import { useState, useEffect } from "react";
import { Bus, Plus, MapPin, Trash2, IndianRupee, CheckCircle2 } from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";
import { formatCurrency } from "@/lib/utils";

export default function TransportPage() {
  const [routes, setRoutes] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [years, setYears] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  // Note: branchId is deliberately NOT part of this form - the backend
  // always scopes creation to the logged-in user's own branch.
  const [form, setForm] = useState({ name: "", startPoint: "", endPoint: "", monthlyFee: "" });

  // Assign Transport Fee (to every student allocated to a route)
  const [assignRoute, setAssignRoute] = useState<any>(null);
  const [assignYearId, setAssignYearId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignResult, setAssignResult] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetch = async () => {
    setLoading(true);
    try {
      const [rRes, vRes, yRes] = await Promise.all([
        api.get("/facilities/transport/routes"),
        api.get("/facilities/transport/vehicles"),
        api.get("/academic-years"),
      ]);
      setRoutes(rRes.data.data || []);
      setVehicles(vRes.data.data || []);
      const yearList = yRes.data.data || [];
      setYears(yearList);
    } catch {} finally { setLoading(false); }
  };
  useEffect(() => { fetch(); }, []);

  const openAssignModal = (route: any) => {
    setAssignRoute(route);
    setAssignResult(null);
    // Preselect the active academic year if there is one, otherwise
    // leave it for the admin to pick.
    const active = years.find((y: any) => y.isActive);
    setAssignYearId(active?.id || years[0]?.id || "");
  };

  const handleAssignTransportFee = async () => {
    if (!assignRoute || !assignYearId) return;
    setAssigning(true);
    setAssignResult(null);
    try {
      const res = await api.post("/fees/assign/transport", {
        routeId: assignRoute.id,
        academicYearId: assignYearId,
      });
      setAssignResult({ type: "success", text: res.data.message || "Transport fee assigned." });
    } catch (err: any) {
      setAssignResult({ type: "error", text: err.response?.data?.message || "Failed to assign transport fee" });
    } finally {
      setAssigning(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/facilities/transport/routes", { ...form, monthlyFee: parseFloat(form.monthlyFee) });
      setShowModal(false); fetch();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  const deleteRoute = async (id: string, name: string) => {
    if (!confirm(`Delete route "${name}"?`)) return;
    try {
      await api.delete(`/facilities/transport/routes/${id}`);
      fetch();
    } catch (err: any) { alert(err.response?.data?.message || "Cannot delete this route"); }
  };

  const deleteVehicle = async (id: string, vehicleNo: string) => {
    if (!confirm(`Delete vehicle "${vehicleNo}"?`)) return;
    try {
      await api.delete(`/facilities/transport/vehicles/${id}`);
      fetch();
    } catch (err: any) { alert(err.response?.data?.message || "Cannot delete this vehicle"); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Bus className="h-6 w-6 text-primary-600" /> Transport</h1>
        <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2"><Plus className="h-4 w-4" /> Add Route</button>
      </div>

      {loading ? <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div> : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {routes.map(r => (
              <div key={r.id} className="card">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-gray-900">{r.name}</h3>
                  <button onClick={() => deleteRoute(r.id, r.name)} title="Delete Route" className="text-red-400 hover:text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-500 mb-2"><MapPin className="h-4 w-4" /> {r.startPoint} → {r.endPoint}</div>
                <div className="flex justify-between text-sm">
                  <span className="text-green-700 font-medium">{formatCurrency(r.monthlyFee)}/month</span>
                  <span className="text-gray-500">{r._count?.allocations || 0} students</span>
                </div>
                {r.stops?.length > 0 && (
                  <div className="mt-3 pt-2 border-t"><p className="text-xs text-gray-400 mb-1">Stops ({r.stops.length}):</p>
                    <div className="flex flex-wrap gap-1">{r.stops.map((s: any) => <span key={s.id} className="text-xs px-2 py-0.5 bg-gray-100 rounded">{s.name}</span>)}</div>
                  </div>
                )}
                <button
                  onClick={() => openAssignModal(r)}
                  disabled={!r._count?.allocations}
                  title={!r._count?.allocations ? "No students allocated to this route yet" : "Assign this route's fee to every allocated student"}
                  className="mt-3 w-full text-xs font-medium text-primary-600 hover:text-primary-700 border border-primary-200 hover:bg-primary-50 rounded-lg py-1.5 flex items-center justify-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <IndianRupee className="h-3.5 w-3.5" /> Assign Fee to Allocated Students
                </button>
              </div>
            ))}
          </div>

          {vehicles.length > 0 && (
            <div className="card"><h3 className="font-semibold mb-3">Vehicles ({vehicles.length})</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {vehicles.map(v => (
                  <div key={v.id} className="bg-gray-50 p-3 rounded-lg text-sm flex items-start justify-between">
                    <div>
                      <p className="font-medium">{v.vehicleNo}</p>
                      <p className="text-xs text-gray-500">{v.type} | Capacity: {v.capacity}</p>
                      {v.driverName && <p className="text-xs text-gray-400">Driver: {v.driverName}</p>}
                    </div>
                    <button onClick={() => deleteVehicle(v.id, v.vehicleNo)} title="Delete Vehicle" className="text-red-400 hover:text-red-600">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Add Route">
        <form onSubmit={handleCreate} className="space-y-4">
          <div><label className="block text-sm font-medium mb-1">Route Name *</label><input className="input-field" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Start Point *</label><input className="input-field" value={form.startPoint} onChange={e => setForm({...form, startPoint: e.target.value})} required /></div>
            <div><label className="block text-sm font-medium mb-1">End Point *</label><input className="input-field" value={form.endPoint} onChange={e => setForm({...form, endPoint: e.target.value})} required /></div>
          </div>
          <div><label className="block text-sm font-medium mb-1">Monthly Fee (Rs) *</label><input type="number" className="input-field" value={form.monthlyFee} onChange={e => setForm({...form, monthlyFee: e.target.value})} required /></div>
          <div className="flex justify-end gap-3 pt-4 border-t"><button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button><button type="submit" className="btn-primary">Create</button></div>
        </form>
      </Modal>

      <Modal isOpen={!!assignRoute} onClose={() => setAssignRoute(null)} title={`Assign Transport Fee - ${assignRoute?.name || ""}`}>
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            This assigns a <span className="font-medium">Transport Fee</span> of{" "}
            <span className="font-medium">{formatCurrency(assignRoute?.monthlyFee || 0)}/month</span> to every one of the{" "}
            <span className="font-medium">{assignRoute?._count?.allocations || 0} student(s)</span> currently allocated to this route.
            Students who already have this fee assigned will be skipped automatically.
          </p>

          {assignResult && (
            <div className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm ${assignResult.type === "success" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
              {assignResult.type === "success" && <CheckCircle2 className="h-4 w-4 flex-shrink-0" />}
              {assignResult.text}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Academic Year *</label>
            <select className="input-field" value={assignYearId} onChange={(e) => setAssignYearId(e.target.value)}>
              <option value="">Select</option>
              {years.map((y: any) => <option key={y.id} value={y.id}>{y.name}</option>)}
            </select>
            {years.length === 0 && (
              <p className="text-xs text-gray-500 mt-1">No academic years found. Create one under Academic Years first.</p>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setAssignRoute(null)} className="btn-secondary">Close</button>
            <button
              type="button"
              onClick={handleAssignTransportFee}
              disabled={assigning || !assignYearId}
              className="btn-primary disabled:opacity-50"
            >
              {assigning ? "Assigning..." : "Assign Fee"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
