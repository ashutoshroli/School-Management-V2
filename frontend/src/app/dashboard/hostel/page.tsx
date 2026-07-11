"use client";

import { useState, useEffect } from "react";
import { Home, Plus, Trash2, Layers, DoorOpen, Users, UserPlus, UserMinus, Search, BarChart3 } from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";
import { formatCurrency } from "@/lib/utils";

const ROOM_TYPES = ["SINGLE", "DOUBLE", "DORMITORY"];

export default function HostelPage() {
  const [buildings, setBuildings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  // Note: branchId is deliberately NOT part of this form - the backend
  // always scopes creation to the logged-in user's own branch.
  const [form, setForm] = useState({ name: "", type: "BOYS", warden: "" });

  // Add Floor
  const [floorBuilding, setFloorBuilding] = useState<any>(null);
  const [floorNo, setFloorNo] = useState("");
  const [addingFloor, setAddingFloor] = useState(false);

  // Add Room
  const [roomFloor, setRoomFloor] = useState<{ buildingName: string; floor: any } | null>(null);
  const [roomForm, setRoomForm] = useState({ roomNo: "", type: "DOUBLE", capacity: "2", monthlyFee: "" });
  const [addingRoom, setAddingRoom] = useState(false);

  // Manage Room (allocate/deallocate students in a specific room)
  const [manageRoom, setManageRoom] = useState<any>(null);
  const [studentSearch, setStudentSearch] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [bedNo, setBedNo] = useState("");
  const [allocatingId, setAllocatingId] = useState<string | null>(null);
  const [deallocatingId, setDeallocatingId] = useState<string | null>(null);

  // Occupancy summary
  const [showOccupancy, setShowOccupancy] = useState(false);
  const [occupancyBuildings, setOccupancyBuildings] = useState<any[]>([]);
  const [occupancyLoading, setOccupancyLoading] = useState(false);

  const fetchBuildings = async () => {
    setLoading(true);
    try { const res = await api.get("/facilities/hostel/buildings"); setBuildings(res.data.data || []); }
    catch {} finally { setLoading(false); }
  };
  useEffect(() => { fetchBuildings(); }, []);

  // Keep the open "Manage Room" modal in sync with the latest fetched
  // building data (e.g. right after allocating/removing a student).
  useEffect(() => {
    if (!manageRoom) return;
    for (const b of buildings) {
      for (const f of b.floors || []) {
        const fresh = f.rooms?.find((r: any) => r.id === manageRoom.id);
        if (fresh) { setManageRoom(fresh); return; }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildings]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api.post("/facilities/hostel/buildings", form); setShowModal(false); setForm({ name: "", type: "BOYS", warden: "" }); fetchBuildings(); }
    catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  const deleteBuilding = async (id: string, name: string) => {
    if (!confirm(`Delete building "${name}"? This will remove all its floors and rooms.`)) return;
    try {
      await api.delete(`/facilities/hostel/buildings/${id}`);
      fetchBuildings();
    } catch (err: any) { alert(err.response?.data?.message || "Cannot delete this building"); }
  };

  const handleAddFloor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!floorBuilding || !floorNo) return;
    setAddingFloor(true);
    try {
      await api.post("/facilities/hostel/floors", { buildingId: floorBuilding.id, floorNo: parseInt(floorNo) });
      setFloorBuilding(null);
      setFloorNo("");
      fetchBuildings();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to add floor");
    } finally {
      setAddingFloor(false);
    }
  };

  const handleAddRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomFloor) return;
    setAddingRoom(true);
    try {
      await api.post("/facilities/hostel/rooms", {
        floorId: roomFloor.floor.id,
        roomNo: roomForm.roomNo,
        type: roomForm.type,
        capacity: parseInt(roomForm.capacity),
        monthlyFee: parseFloat(roomForm.monthlyFee) || 0,
      });
      setRoomFloor(null);
      setRoomForm({ roomNo: "", type: "DOUBLE", capacity: "2", monthlyFee: "" });
      fetchBuildings();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to add room");
    } finally {
      setAddingRoom(false);
    }
  };

  const openManageRoom = (room: any) => {
    setManageRoom(room);
    setStudentSearch("");
    setSearchResults([]);
    setBedNo("");
  };

  const searchStudents = async () => {
    if (!studentSearch.trim()) { setSearchResults([]); return; }
    setSearchLoading(true);
    try {
      const res = await api.get("/students", { params: { search: studentSearch, limit: 20 } });
      setSearchResults(res.data.data || []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  };

  const allocate = async (studentId: string) => {
    if (!manageRoom) return;
    setAllocatingId(studentId);
    try {
      await api.post("/facilities/hostel/allocate", { studentId, roomId: manageRoom.id, bedNo: bedNo || undefined });
      await fetchBuildings();
      setSearchResults([]);
      setStudentSearch("");
      setBedNo("");
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to allocate room");
    } finally {
      setAllocatingId(null);
    }
  };

  const deallocate = async (allocationId: string, name: string) => {
    if (!confirm(`Deallocate ${name} from this room?`)) return;
    setDeallocatingId(allocationId);
    try {
      await api.patch(`/facilities/hostel/deallocate/${allocationId}`);
      await fetchBuildings();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to deallocate");
    } finally {
      setDeallocatingId(null);
    }
  };

  const openOccupancy = async () => {
    setShowOccupancy(true);
    setOccupancyLoading(true);
    try {
      const res = await api.get("/facilities/hostel/occupancy");
      setOccupancyBuildings(res.data.data || []);
    } catch {
      setOccupancyBuildings([]);
    } finally {
      setOccupancyLoading(false);
    }
  };

  // Flatten every room across every building/floor for the summary table.
  const occupancySummary = occupancyBuildings.flatMap((b) =>
    (b.floors || []).flatMap((f: any) =>
      (f.rooms || []).map((r: any) => ({ ...r, buildingName: b.name, floorNo: f.floorNo }))
    )
  );
  const totalCapacity = occupancySummary.reduce((sum, r) => sum + r.capacity, 0);
  const totalOccupied = occupancySummary.reduce((sum, r) => sum + r.occupied, 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Home className="h-6 w-6 text-primary-600" /> Hostel
        </h1>
        <div className="flex items-center gap-2">
          <button onClick={openOccupancy} className="btn-secondary flex items-center gap-2">
            <BarChart3 className="h-4 w-4" /> Occupancy
          </button>
          <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2">
            <Plus className="h-4 w-4" /> Add Building
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
        </div>
      ) : buildings.length === 0 ? (
        <p className="text-center text-gray-500 py-12">No hostel buildings configured</p>
      ) : (
        <div className="space-y-6">
          {buildings.map((b) => (
            <div key={b.id} className="card">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-lg">{b.name}</h3>
                  <p className="text-sm text-gray-500">
                    {b.type} | Warden: {b.warden || "Not assigned"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${b.type === "BOYS" ? "bg-blue-100 text-blue-700" : "bg-pink-100 text-pink-700"}`}>
                    {b.type}
                  </span>
                  <button
                    onClick={() => setFloorBuilding(b)}
                    title="Add Floor"
                    className="text-xs font-medium text-primary-600 hover:text-primary-700 border border-primary-200 hover:bg-primary-50 rounded-lg px-2.5 py-1 flex items-center gap-1"
                  >
                    <Layers className="h-3.5 w-3.5" /> Add Floor
                  </button>
                  <button onClick={() => deleteBuilding(b.id, b.name)} title="Delete Building" className="text-red-400 hover:text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {b.floors?.map((f: any) => (
                <div key={f.id} className="mb-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-gray-600">Floor {f.floorNo}</p>
                    <button
                      onClick={() => setRoomFloor({ buildingName: b.name, floor: f })}
                      className="text-xs font-medium text-primary-600 hover:text-primary-700 flex items-center gap-1"
                    >
                      <DoorOpen className="h-3.5 w-3.5" /> Add Room
                    </button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                    {f.rooms?.map((r: any) => (
                      <button
                        key={r.id}
                        onClick={() => openManageRoom(r)}
                        title="Click to manage students in this room"
                        className={`p-2 rounded-lg text-center text-xs border hover:ring-2 hover:ring-primary-300 transition-all ${r.occupied >= r.capacity ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200"}`}
                      >
                        <p className="font-bold">{r.roomNo}</p>
                        <p className="text-gray-500">{r.occupied}/{r.capacity}</p>
                        <p className="text-[10px] text-gray-400">{r.type}</p>
                      </button>
                    ))}
                    {(!f.rooms || f.rooms.length === 0) && (
                      <p className="text-xs text-gray-400 col-span-full">No rooms yet - click "Add Room" above</p>
                    )}
                  </div>
                </div>
              ))}
              {(!b.floors || b.floors.length === 0) && (
                <p className="text-sm text-gray-400">No floors yet - click "Add Floor" above</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add Building */}
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

      {/* Add Floor */}
      <Modal isOpen={!!floorBuilding} onClose={() => setFloorBuilding(null)} title={`Add Floor - ${floorBuilding?.name || ""}`}>
        <form onSubmit={handleAddFloor} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Floor Number *</label>
            <input type="number" className="input-field" value={floorNo} onChange={(e) => setFloorNo(e.target.value)} required placeholder="e.g. 0 for Ground Floor, 1, 2..." />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setFloorBuilding(null)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={addingFloor} className="btn-primary disabled:opacity-50">{addingFloor ? "Adding..." : "Add Floor"}</button>
          </div>
        </form>
      </Modal>

      {/* Add Room */}
      <Modal isOpen={!!roomFloor} onClose={() => setRoomFloor(null)} title={`Add Room - ${roomFloor?.buildingName || ""}, Floor ${roomFloor?.floor?.floorNo ?? ""}`}>
        <form onSubmit={handleAddRoom} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Room Number *</label>
            <input className="input-field" value={roomForm.roomNo} onChange={(e) => setRoomForm({ ...roomForm, roomNo: e.target.value })} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Type *</label>
              <select className="input-field" value={roomForm.type} onChange={(e) => setRoomForm({ ...roomForm, type: e.target.value })}>
                {ROOM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Capacity *</label>
              <input type="number" min="1" className="input-field" value={roomForm.capacity} onChange={(e) => setRoomForm({ ...roomForm, capacity: e.target.value })} required />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Monthly Fee (Rs) *</label>
            <input type="number" min="0" className="input-field" value={roomForm.monthlyFee} onChange={(e) => setRoomForm({ ...roomForm, monthlyFee: e.target.value })} required />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setRoomFloor(null)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={addingRoom} className="btn-primary disabled:opacity-50">{addingRoom ? "Adding..." : "Add Room"}</button>
          </div>
        </form>
      </Modal>

      {/* Manage Room (allocate/deallocate) */}
      <Modal isOpen={!!manageRoom} onClose={() => setManageRoom(null)} title={`Room ${manageRoom?.roomNo || ""} - ${manageRoom?.occupied ?? 0}/${manageRoom?.capacity ?? 0} occupied`} size="lg">
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-semibold text-gray-600 mb-2 flex items-center gap-1">
              <Users className="h-4 w-4" /> Current Residents ({manageRoom?.allocations?.length || 0})
            </h4>
            {manageRoom?.allocations?.length > 0 ? (
              <div className="space-y-2 max-h-56 overflow-y-auto">
                {manageRoom.allocations.map((a: any) => (
                  <div key={a.id} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded-lg text-sm">
                    <div>
                      <p className="font-medium">{a.student?.user?.name}</p>
                      <p className="text-xs text-gray-500">
                        {a.student?.admissionNo}
                        {a.bedNo ? ` \u2022 Bed: ${a.bedNo}` : ""}
                      </p>
                    </div>
                    <button
                      onClick={() => deallocate(a.id, a.student?.user?.name)}
                      disabled={deallocatingId === a.id}
                      title="Deallocate"
                      className="p-1.5 text-red-500 hover:bg-red-50 rounded disabled:opacity-40"
                    >
                      <UserMinus className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">No students allocated yet - search below to add one.</p>
            )}
          </div>

          {manageRoom && manageRoom.occupied < manageRoom.capacity ? (
            <div className="pt-3 border-t">
              <h4 className="text-sm font-semibold text-gray-600 mb-2">Allocate Student</h4>
              <div className="flex gap-2 mb-3">
                <div className="relative flex-1">
                  <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    className="input-field pl-9 w-full"
                    placeholder="Search by name, admission no, roll no..."
                    value={studentSearch}
                    onChange={(e) => setStudentSearch(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && searchStudents()}
                  />
                </div>
                <input
                  className="input-field w-24"
                  placeholder="Bed no."
                  value={bedNo}
                  onChange={(e) => setBedNo(e.target.value)}
                />
                <button type="button" onClick={searchStudents} className="btn-secondary text-sm">Search</button>
              </div>

              {searchLoading ? (
                <div className="flex justify-center py-4">
                  <div className="animate-spin h-5 w-5 border-4 border-primary-600 border-t-transparent rounded-full" />
                </div>
              ) : searchResults.length > 0 ? (
                <div className="space-y-2 max-h-56 overflow-y-auto">
                  {searchResults.map((s: any) => (
                    <div key={s.id} className="flex items-center justify-between border px-3 py-2 rounded-lg text-sm">
                      <div>
                        <p className="font-medium">{s.user?.name}</p>
                        <p className="text-xs text-gray-500">{s.admissionNo} &bull; {s.class?.name}{s.section?.name ? `-${s.section.name}` : ""}</p>
                      </div>
                      <button
                        onClick={() => allocate(s.id)}
                        disabled={allocatingId === s.id}
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700 disabled:opacity-40"
                      >
                        <UserPlus className="h-3.5 w-3.5" /> {allocatingId === s.id ? "Adding..." : "Allocate"}
                      </button>
                    </div>
                  ))}
                </div>
              ) : studentSearch.trim() ? (
                <p className="text-sm text-gray-400">No students found</p>
              ) : null}
            </div>
          ) : (
            manageRoom && <p className="text-sm text-amber-600 pt-3 border-t">Room is full - deallocate a resident first to add another.</p>
          )}

          <div className="flex justify-end pt-4 border-t">
            <button type="button" onClick={() => setManageRoom(null)} className="btn-secondary">Close</button>
          </div>
        </div>
      </Modal>

      {/* Occupancy Summary */}
      <Modal isOpen={showOccupancy} onClose={() => setShowOccupancy(false)} title="Hostel Occupancy Summary" size="lg">
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-primary-50 px-4 py-3 rounded-lg">
            <span className="text-sm font-medium text-primary-900">Overall Occupancy</span>
            <span className="text-lg font-bold text-primary-700">
              {totalOccupied}/{totalCapacity} {totalCapacity > 0 ? `(${Math.round((totalOccupied / totalCapacity) * 100)}%)` : ""}
            </span>
          </div>

          {occupancyLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" />
            </div>
          ) : occupancySummary.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No rooms configured yet</p>
          ) : (
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50">
                  <tr className="border-b">
                    <th className="px-3 py-2 text-left">Building</th>
                    <th className="px-3 py-2 text-left">Floor</th>
                    <th className="px-3 py-2 text-left">Room</th>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-right">Occupancy</th>
                    <th className="px-3 py-2 text-right">Monthly Fee</th>
                  </tr>
                </thead>
                <tbody>
                  {occupancySummary.map((r: any) => (
                    <tr key={r.id} className="border-b">
                      <td className="px-3 py-2">{r.buildingName}</td>
                      <td className="px-3 py-2">{r.floorNo}</td>
                      <td className="px-3 py-2 font-medium">{r.roomNo}</td>
                      <td className="px-3 py-2 text-gray-500">{r.type}</td>
                      <td className={`px-3 py-2 text-right font-medium ${r.occupied >= r.capacity ? "text-red-600" : "text-green-600"}`}>
                        {r.occupied}/{r.capacity}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-500">{formatCurrency(r.monthlyFee)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-end pt-4 border-t">
            <button type="button" onClick={() => setShowOccupancy(false)} className="btn-secondary">Close</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
