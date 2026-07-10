"use client";

import { useState, useEffect } from "react";
import { Bus, Plus, MapPin } from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";
import { formatCurrency } from "@/lib/utils";

export default function TransportPage() {
  const [routes, setRoutes] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: "", startPoint: "", endPoint: "", monthlyFee: "", branchId: "" });

  const fetch = async () => {
    setLoading(true);
    try {
      const [rRes, vRes] = await Promise.all([api.get("/facilities/transport/routes"), api.get("/facilities/transport/vehicles")]);
      setRoutes(rRes.data.data || []);
      setVehicles(vRes.data.data || []);
    } catch {} finally { setLoading(false); }
  };
  useEffect(() => { fetch(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/facilities/transport/routes", { ...form, monthlyFee: parseFloat(form.monthlyFee) });
      setShowModal(false); fetch();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
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
                <h3 className="font-semibold text-gray-900 mb-2">{r.name}</h3>
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
              </div>
            ))}
          </div>

          {vehicles.length > 0 && (
            <div className="card"><h3 className="font-semibold mb-3">Vehicles ({vehicles.length})</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {vehicles.map(v => (
                  <div key={v.id} className="bg-gray-50 p-3 rounded-lg text-sm">
                    <p className="font-medium">{v.vehicleNo}</p>
                    <p className="text-xs text-gray-500">{v.type} | Capacity: {v.capacity}</p>
                    {v.driverName && <p className="text-xs text-gray-400">Driver: {v.driverName}</p>}
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
    </div>
  );
}
