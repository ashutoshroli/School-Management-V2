"use client";

import { useState, useEffect } from "react";
import { Home, Plus } from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";

export default function HostelPage() {
  const [buildings, setBuildings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: "", type: "BOYS", warden: "", branchId: "" });

  const fetch = async () => {
    setLoading(true);
    try { const res = await api.get("/facilities/hostel/buildings"); setBuildings(res.data.data || []); }
    catch {} finally { setLoading(false); }
  };
  useEffect(() => { fetch(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api.post("/facilities/hostel/buildings", form); setShowModal(false); fetch(); }
    catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Home className="h-6 w-6 text-primary-600" /> Hostel
        </h1>
        <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2">
          <Plus className="h-4 w-4" /> Add Building
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
        </div>
      ) : buildings.length === 0 ? (
        <p className="text-center text-gray-500 py-12">No hostel buildings configured</p>
      ) : (
        <div className="space-y-6">
          {buildings.map(b => (
            <div key={b.id} className="card">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-lg">{b.name}</h3>
                  <p className="text-sm text-gray-500">
                    {b.type} | Warden: {b.warden || "Not assigned"}
                  </p>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${b.type === "BOYS" ? "bg-blue-100 text-blue-700" : "bg-pink-100 text-pink-700"}`}>
                  {b.type}
                </span>
              </div>


              {b.floors?.map((f: any) => (
                <div key={f.id} className="mb-3">
                  <p className="text-sm font-medium text-gray-600 mb-2">Floor {f.floorNo}</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                    {f.rooms?.map((r: any) => (
                      <div key={r.id} className={`p-2 rounded-lg text-center text-xs border ${r.occupied >= r.capacity ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200"}`}>
                        <p className="font-bold">{r.roomNo}</p>
                        <p className="text-gray-500">{r.occupied}/{r.capacity}</p>
                        <p className="text-[10px] text-gray-400">{r.type}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {(!b.floors || b.floors.length === 0) && <p className="text-sm text-gray-400">No floors/rooms configured</p>}
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Add Hostel Building">
        <form onSubmit={handleCreate} className="space-y-4">
          <div><label className="block text-sm font-medium mb-1">Building Name *</label>
            <input className="input-field" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required /></div>
          <div><label className="block text-sm font-medium mb-1">Type *</label>
            <select className="input-field" value={form.type} onChange={e => setForm({...form, type: e.target.value})}>
              <option value="BOYS">Boys</option><option value="GIRLS">Girls</option>
            </select></div>
          <div><label className="block text-sm font-medium mb-1">Warden Name</label>
            <input className="input-field" value={form.warden} onChange={e => setForm({...form, warden: e.target.value})} /></div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">Create</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
