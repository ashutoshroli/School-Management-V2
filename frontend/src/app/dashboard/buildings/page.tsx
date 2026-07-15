"use client";

import { useState, useEffect } from "react";
import { Building, Plus, Trash2, Layers, DoorOpen, BarChart3, Edit, Users, X } from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";
import { usePermissions } from "@/hooks/usePermissions";

const ROOM_TYPES = [
  "CLASSROOM", "LAB", "OFFICE", "CHAMBER", "TEACHER_CHAMBER", "STAFF_ROOM", "LIBRARY",
  "AUDITORIUM", "SPORTS_ROOM", "TOILET", "STORE", "CANTEEN", "MEDICAL_ROOM", "OTHER",
];

// General-purpose (non-hostel) school building structure - Building ->
// Floor -> Room, for classrooms/labs/offices/etc. Mirrors the Hostel
// page's exact UX shape (see /dashboard/hostel/page.tsx) since the
// backend models/endpoints follow the same pattern.
export default function SchoolBuildingsPage() {
  const { canEdit, canDelete } = usePermissions();
  const [buildings, setBuildings] = useState<any[]>([]);
  const [staffList, setStaffList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });

  // Add Floor
  const [floorBuilding, setFloorBuilding] = useState<any>(null);
  const [floorForm, setFloorForm] = useState({ floorNo: "", name: "" });
  const [addingFloor, setAddingFloor] = useState(false);

  // Bulk Add Floors - set up N floors on a building in one call
  // instead of one addSchoolFloor call each.
  const [bulkFloorBuilding, setBulkFloorBuilding] = useState<any>(null);
  const [bulkFloorForm, setBulkFloorForm] = useState({ count: "1", startingFloorNo: "0", namePrefix: "" });
  const [addingBulkFloors, setAddingBulkFloors] = useState(false);

  // Bulk Add Rooms - a whole list of rooms on one floor in one call.
  const [bulkRoomFloor, setBulkRoomFloor] = useState<{ buildingName: string; floor: any } | null>(null);
  const [bulkRoomRows, setBulkRoomRows] = useState<any[]>([{ roomNo: "", name: "", type: "CLASSROOM", capacity: "0" }]);
  const [addingBulkRooms, setAddingBulkRooms] = useState(false);

  // Multi-cabin chambers (RoomCabin) - only for CHAMBER/OFFICE/
  // STAFF_ROOM-type rooms that need several named seats tracked
  // individually, alongside SchoolRoom.assignedStaffId's existing
  // single-occupant case (unaffected, opt-in only).
  const [cabinsFor, setCabinsFor] = useState<any>(null);
  const [cabins, setCabins] = useState<any[]>([]);
  const [loadingCabins, setLoadingCabins] = useState(false);
  const [newCabinNo, setNewCabinNo] = useState("");
  const [newCabinStaffId, setNewCabinStaffId] = useState("");

  // Add/Edit Room
  const [roomFloor, setRoomFloor] = useState<{ buildingName: string; floor: any } | null>(null);
  const [editingRoom, setEditingRoom] = useState<any>(null);
  const [roomForm, setRoomForm] = useState({
    roomNo: "", name: "", type: "CLASSROOM", capacity: "0", directionFromGate: "", assignedStaffId: "", department: "",
  });
  const [savingRoom, setSavingRoom] = useState(false);

  // Occupancy summary
  const [showOccupancy, setShowOccupancy] = useState(false);
  const [occupancy, setOccupancy] = useState<any>(null);
  const [occupancyLoading, setOccupancyLoading] = useState(false);

  const fetchBuildings = async () => {
    setLoading(true);
    try {
      const res = await api.get("/facilities/school-buildings");
      setBuildings(res.data.data || []);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => {
    fetchBuildings();
    api.get("/staff").then((res) => setStaffList(res.data.data || [])).catch(() => {});
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/facilities/school-buildings", form);
      setShowModal(false);
      setForm({ name: "", description: "" });
      fetchBuildings();
    } catch (err: any) { alert(err.response?.data?.message || "Failed to create building"); }
  };

  const deleteBuilding = async (id: string, name: string) => {
    if (!confirm(`Delete building "${name}"? This will remove all its floors and rooms.`)) return;
    try {
      await api.delete(`/facilities/school-buildings/${id}`);
      fetchBuildings();
    } catch (err: any) { alert(err.response?.data?.message || "Cannot delete this building"); }
  };

  const handleAddFloor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!floorBuilding || !floorForm.floorNo) return;
    setAddingFloor(true);
    try {
      await api.post("/facilities/school-buildings/floors", {
        buildingId: floorBuilding.id, floorNo: parseInt(floorForm.floorNo, 10), name: floorForm.name || undefined,
      });
      setFloorBuilding(null);
      setFloorForm({ floorNo: "", name: "" });
      fetchBuildings();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to add floor");
    } finally {
      setAddingFloor(false);
    }
  };

  const openAddRoom = (buildingName: string, floor: any) => {
    setRoomFloor({ buildingName, floor });
    setEditingRoom(null);
    setRoomForm({ roomNo: "", name: "", type: "CLASSROOM", capacity: "0", directionFromGate: "", assignedStaffId: "", department: "" });
  };

  const openEditRoom = (buildingName: string, floor: any, room: any) => {
    setRoomFloor({ buildingName, floor });
    setEditingRoom(room);
    setRoomForm({
      roomNo: room.roomNo, name: room.name || "", type: room.type, capacity: String(room.capacity),
      directionFromGate: room.directionFromGate || "", assignedStaffId: room.assignedStaffId || "", department: room.department || "",
    });
  };

  const handleSaveRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingRoom(true);
    const payload = {
      roomNo: roomForm.roomNo,
      name: roomForm.name || undefined,
      type: roomForm.type,
      capacity: parseInt(roomForm.capacity, 10) || 0,
      directionFromGate: roomForm.directionFromGate || undefined,
      assignedStaffId: roomForm.assignedStaffId || undefined,
      department: roomForm.department || undefined,
    };
    try {
      if (editingRoom) {
        await api.put(`/facilities/school-buildings/rooms/${editingRoom.id}`, payload);
      } else {
        await api.post("/facilities/school-buildings/rooms", { ...payload, floorId: roomFloor?.floor.id });
      }
      setRoomFloor(null);
      setEditingRoom(null);
      fetchBuildings();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to save room");
    } finally {
      setSavingRoom(false);
    }
  };

  const deleteRoom = async (id: string, roomNo: string) => {
    if (!confirm(`Delete room "${roomNo}"?`)) return;
    try {
      await api.delete(`/facilities/school-buildings/rooms/${id}`);
      fetchBuildings();
    } catch (err: any) { alert(err.response?.data?.message || "Cannot delete this room"); }
  };

  const handleBulkAddFloors = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkFloorBuilding) return;
    setAddingBulkFloors(true);
    try {
      await api.post("/facilities/school-buildings/floors/bulk", {
        buildingId: bulkFloorBuilding.id,
        count: parseInt(bulkFloorForm.count, 10),
        startingFloorNo: parseInt(bulkFloorForm.startingFloorNo, 10) || 0,
        namePrefix: bulkFloorForm.namePrefix || undefined,
      });
      setBulkFloorBuilding(null);
      setBulkFloorForm({ count: "1", startingFloorNo: "0", namePrefix: "" });
      fetchBuildings();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to add floors");
    } finally {
      setAddingBulkFloors(false);
    }
  };

  const openBulkAddRooms = (buildingName: string, floor: any) => {
    setBulkRoomFloor({ buildingName, floor });
    setBulkRoomRows([{ roomNo: "", name: "", type: "CLASSROOM", capacity: "0" }]);
  };

  const addBulkRoomRow = () => setBulkRoomRows([...bulkRoomRows, { roomNo: "", name: "", type: "CLASSROOM", capacity: "0" }]);
  const removeBulkRoomRow = (i: number) => setBulkRoomRows(bulkRoomRows.filter((_, idx) => idx !== i));
  const updateBulkRoomRow = (i: number, field: string, value: string) =>
    setBulkRoomRows(bulkRoomRows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));

  const handleBulkAddRooms = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkRoomFloor) return;
    const rows = bulkRoomRows.filter((r) => r.roomNo);
    if (rows.length === 0) {
      alert("Add at least one room with a room number");
      return;
    }
    setAddingBulkRooms(true);
    try {
      await api.post("/facilities/school-buildings/rooms/bulk", {
        floorId: bulkRoomFloor.floor.id,
        rooms: rows.map((r) => ({ roomNo: r.roomNo, name: r.name || undefined, type: r.type, capacity: parseInt(r.capacity, 10) || 0 })),
      });
      setBulkRoomFloor(null);
      fetchBuildings();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to add rooms");
    } finally {
      setAddingBulkRooms(false);
    }
  };

  const openCabins = async (room: any) => {
    setCabinsFor(room);
    setNewCabinNo("");
    setNewCabinStaffId("");
    setLoadingCabins(true);
    try {
      const res = await api.get(`/facilities/school-buildings/rooms/${room.id}/cabins`);
      setCabins(res.data.data || []);
    } catch {
      setCabins([]);
    } finally {
      setLoadingCabins(false);
    }
  };

  const handleAddCabin = async () => {
    if (!cabinsFor || !newCabinNo) return;
    try {
      const res = await api.post("/facilities/school-buildings/cabins", {
        roomId: cabinsFor.id, cabinNo: newCabinNo, staffId: newCabinStaffId || undefined,
      });
      setCabins((prev) => [...prev, res.data.data]);
      setNewCabinNo("");
      setNewCabinStaffId("");
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to add cabin");
    }
  };

  const handleUpdateCabinStaff = async (cabinId: string, staffId: string) => {
    try {
      await api.put(`/facilities/school-buildings/cabins/${cabinId}`, { staffId: staffId || null });
      setCabins((prev) => prev.map((c) => (c.id === cabinId ? { ...c, staffId: staffId || null, staff: staffList.find((s) => s.id === staffId) || null } : c)));
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to update cabin");
    }
  };

  const handleDeleteCabin = async (cabinId: string) => {
    if (!confirm("Delete this cabin?")) return;
    try {
      await api.delete(`/facilities/school-buildings/cabins/${cabinId}`);
      setCabins((prev) => prev.filter((c) => c.id !== cabinId));
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to delete cabin");
    }
  };

  const openOccupancy = async () => {
    setShowOccupancy(true);
    setOccupancyLoading(true);
    try {
      const res = await api.get("/facilities/school-buildings/occupancy");
      setOccupancy(res.data.data);
    } catch {
      setOccupancy(null);
    } finally {
      setOccupancyLoading(false);
    }
  };

  const roomColor = (room: any) => {
    if (room.type !== "CLASSROOM") return "bg-gray-50 border-gray-200";
    const occupied = (room.sections || []).reduce((sum: number, s: any) => sum + (s._count?.students || 0), 0);
    if (room.capacity === 0) return "bg-gray-50 border-gray-200";
    return occupied >= room.capacity ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200";
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Building className="h-6 w-6 text-primary-600" /> School Buildings
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
        <p className="text-center text-gray-500 py-12">No school buildings configured yet</p>
      ) : (
        <div className="space-y-6">
          {buildings.map((b) => (
            <div key={b.id} className="card">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-lg">{b.name}</h3>
                  {b.description && <p className="text-sm text-gray-500">{b.description}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setFloorBuilding(b)}
                    title="Add Floor"
                    className="text-xs font-medium text-primary-600 hover:text-primary-700 border border-primary-200 hover:bg-primary-50 rounded-lg px-2.5 py-1 flex items-center gap-1"
                  >
                    <Layers className="h-3.5 w-3.5" /> Add Floor
                  </button>
                  <button
                    onClick={() => setBulkFloorBuilding(b)}
                    title="Add Multiple Floors at once"
                    className="text-xs font-medium text-primary-600 hover:text-primary-700 border border-primary-200 hover:bg-primary-50 rounded-lg px-2.5 py-1 flex items-center gap-1"
                  >
                    <Layers className="h-3.5 w-3.5" /> Add Multiple Floors
                  </button>
                  {canDelete && (
                    <button onClick={() => deleteBuilding(b.id, b.name)} title="Delete Building" className="text-red-400 hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              {b.floors?.map((f: any) => (
                <div key={f.id} className="mb-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-gray-600">{f.name || `Floor ${f.floorNo}`}</p>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => openAddRoom(b.name, f)}
                        className="text-xs font-medium text-primary-600 hover:text-primary-700 flex items-center gap-1"
                      >
                        <DoorOpen className="h-3.5 w-3.5" /> Add Room
                      </button>
                      <button
                        onClick={() => openBulkAddRooms(b.name, f)}
                        className="text-xs font-medium text-primary-600 hover:text-primary-700 flex items-center gap-1"
                      >
                        <DoorOpen className="h-3.5 w-3.5" /> Add Multiple Rooms
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                    {f.rooms?.map((r: any) => {
                      const occupied = (r.sections || []).reduce((sum: number, s: any) => sum + (s._count?.students || 0), 0);
                      return (
                        <div key={r.id} className={`p-2 rounded-lg text-center text-xs border relative group ${roomColor(r)}`}>
                          {canEdit && (
                            <button onClick={() => openEditRoom(b.name, f, r)} className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-700">
                              <Edit className="h-3 w-3" />
                            </button>
                          )}
                          <p className="font-bold">{r.roomNo}</p>
                          {r.name && <p className="text-gray-500 truncate">{r.name}</p>}
                          {r.type === "CLASSROOM" && r.capacity > 0 && <p className="text-gray-500">{occupied}/{r.capacity}</p>}
                          {r.type === "CHAMBER" && r.assignedStaff && <p className="text-gray-500 truncate">{r.assignedStaff.user?.name}</p>}
                          <p className="text-[10px] text-gray-400">{r.type.replace(/_/g, " ")}</p>
                          {(r.type === "CHAMBER" || r.type === "OFFICE" || r.type === "STAFF_ROOM" || r.type === "TEACHER_CHAMBER") && (
                            <button onClick={() => openCabins(r)} title="Manage cabins (multiple teachers sharing this room)" className="text-primary-500 hover:text-primary-700 text-[10px] mt-1 flex items-center justify-center gap-0.5 w-full">
                              <Users className="h-3 w-3" /> Cabins
                            </button>
                          )}
                          {canDelete && (
                            <button onClick={() => deleteRoom(r.id, r.roomNo)} className="text-red-400 hover:text-red-600 text-[10px] mt-1 block w-full">
                              <Trash2 className="h-3 w-3 inline" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {(!f.rooms || f.rooms.length === 0) && (
                      <p className="text-xs text-gray-400 col-span-full">No rooms yet - click &quot;Add Room&quot; above</p>
                    )}
                  </div>
                </div>
              ))}
              {(!b.floors || b.floors.length === 0) && (
                <p className="text-sm text-gray-400">No floors yet - click &quot;Add Floor&quot; above</p>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Add School Building">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Building Name *</label>
            <input className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="e.g. Main Academic Block" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <input className="input-field" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">Create</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!floorBuilding} onClose={() => setFloorBuilding(null)} title={`Add Floor - ${floorBuilding?.name || ""}`}>
        <form onSubmit={handleAddFloor} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Floor Number *</label>
            <input type="number" className="input-field" value={floorForm.floorNo} onChange={(e) => setFloorForm({ ...floorForm, floorNo: e.target.value })} required placeholder="e.g. 0 for Ground Floor, 1, 2..." />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Floor Name (optional)</label>
            <input className="input-field" value={floorForm.name} onChange={(e) => setFloorForm({ ...floorForm, name: e.target.value })} placeholder="e.g. Ground Floor" />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setFloorBuilding(null)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={addingFloor} className="btn-primary disabled:opacity-50">{addingFloor ? "Adding..." : "Add Floor"}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!bulkFloorBuilding} onClose={() => setBulkFloorBuilding(null)} title={`Add Multiple Floors - ${bulkFloorBuilding?.name || ""}`}>
        <form onSubmit={handleBulkAddFloors} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">How many floors? *</label>
            <input type="number" min={1} max={50} className="input-field" value={bulkFloorForm.count} onChange={(e) => setBulkFloorForm({ ...bulkFloorForm, count: e.target.value })} required />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Starting Floor Number</label>
            <input type="number" className="input-field" value={bulkFloorForm.startingFloorNo} onChange={(e) => setBulkFloorForm({ ...bulkFloorForm, startingFloorNo: e.target.value })} placeholder="e.g. 0 for Ground Floor" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Name Prefix (optional)</label>
            <input className="input-field" value={bulkFloorForm.namePrefix} onChange={(e) => setBulkFloorForm({ ...bulkFloorForm, namePrefix: e.target.value })} placeholder="e.g. Wing A -> 'Wing A Floor 1', 'Wing A Floor 2'..." />
          </div>
          <p className="text-xs text-gray-400">This will create floors {bulkFloorForm.startingFloorNo || 0} to {(parseInt(bulkFloorForm.startingFloorNo || "0", 10) + Math.max(parseInt(bulkFloorForm.count || "1", 10), 1) - 1)}.</p>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setBulkFloorBuilding(null)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={addingBulkFloors} className="btn-primary disabled:opacity-50">{addingBulkFloors ? "Adding..." : "Add Floors"}</button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={!!bulkRoomFloor}
        onClose={() => setBulkRoomFloor(null)}
        title={`Add Multiple Rooms - ${bulkRoomFloor?.buildingName || ""}, ${bulkRoomFloor?.floor?.name || `Floor ${bulkRoomFloor?.floor?.floorNo ?? ""}`}`}
        size="lg"
      >
        <form onSubmit={handleBulkAddRooms} className="space-y-4">
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {bulkRoomRows.map((r, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <input className="input-field col-span-3" placeholder="Room No *" value={r.roomNo} onChange={(e) => updateBulkRoomRow(i, "roomNo", e.target.value)} />
                <input className="input-field col-span-3" placeholder="Name" value={r.name} onChange={(e) => updateBulkRoomRow(i, "name", e.target.value)} />
                <select className="input-field col-span-3" value={r.type} onChange={(e) => updateBulkRoomRow(i, "type", e.target.value)}>
                  {ROOM_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                </select>
                <input type="number" min={0} className="input-field col-span-2" placeholder="Capacity" value={r.capacity} onChange={(e) => updateBulkRoomRow(i, "capacity", e.target.value)} />
                <button type="button" onClick={() => removeBulkRoomRow(i)} className="col-span-1 text-red-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
          <button type="button" onClick={addBulkRoomRow} className="btn-secondary flex items-center gap-2 text-sm"><Plus className="h-4 w-4" /> Add Row</button>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setBulkRoomFloor(null)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={addingBulkRooms} className="btn-primary disabled:opacity-50">{addingBulkRooms ? "Adding..." : `Add ${bulkRoomRows.filter((r) => r.roomNo).length} Room(s)`}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!cabinsFor} onClose={() => setCabinsFor(null)} title={cabinsFor ? `Cabins - Room ${cabinsFor.roomNo}` : "Cabins"}>
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Multiple teachers can share this room, each with their own named cabin. This is independent of the room&apos;s
            single &quot;Assigned Staff&quot; field above.
          </p>
          {loadingCabins ? (
            <div className="flex justify-center py-6"><div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {cabins.map((c) => (
                <div key={c.id} className="flex items-center gap-2 border rounded-lg px-3 py-2">
                  <span className="text-sm font-medium w-16">{c.cabinNo}</span>
                  <select
                    className="input-field flex-1"
                    value={c.staffId || ""}
                    onChange={(e) => handleUpdateCabinStaff(c.id, e.target.value)}
                  >
                    <option value="">Vacant</option>
                    {staffList.map((s: any) => <option key={s.id} value={s.id}>{s.user?.name} ({s.designation})</option>)}
                  </select>
                  {canDelete && (
                    <button onClick={() => handleDeleteCabin(c.id)} className="text-red-400 hover:text-red-600"><X className="h-4 w-4" /></button>
                  )}
                </div>
              ))}
              {cabins.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No cabins yet - add one below</p>}
            </div>
          )}
          <div className="flex items-center gap-2 pt-3 border-t">
            <input className="input-field w-24" placeholder="Cabin No" value={newCabinNo} onChange={(e) => setNewCabinNo(e.target.value)} />
            <select className="input-field flex-1" value={newCabinStaffId} onChange={(e) => setNewCabinStaffId(e.target.value)}>
              <option value="">Vacant</option>
              {staffList.map((s: any) => <option key={s.id} value={s.id}>{s.user?.name} ({s.designation})</option>)}
            </select>
            <button type="button" onClick={handleAddCabin} disabled={!newCabinNo} className="btn-primary flex items-center gap-1 disabled:opacity-50"><Plus className="h-4 w-4" /> Add</button>
          </div>
          <div className="flex justify-end pt-2">
            <button type="button" onClick={() => setCabinsFor(null)} className="btn-secondary">Close</button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={!!roomFloor}
        onClose={() => { setRoomFloor(null); setEditingRoom(null); }}
        title={editingRoom ? `Edit Room - ${roomFloor?.buildingName || ""}` : `Add Room - ${roomFloor?.buildingName || ""}, ${roomFloor?.floor?.name || `Floor ${roomFloor?.floor?.floorNo ?? ""}`}`}
      >
        <form onSubmit={handleSaveRoom} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Room Number *</label>
              <input className="input-field" value={roomForm.roomNo} onChange={(e) => setRoomForm({ ...roomForm, roomNo: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Room Name</label>
              <input className="input-field" value={roomForm.name} onChange={(e) => setRoomForm({ ...roomForm, name: e.target.value })} placeholder="e.g. Physics Lab" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Room Type *</label>
              <select className="input-field" value={roomForm.type} onChange={(e) => setRoomForm({ ...roomForm, type: e.target.value })}>
                {ROOM_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Capacity</label>
              <input type="number" min="0" className="input-field" value={roomForm.capacity} onChange={(e) => setRoomForm({ ...roomForm, capacity: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Direction from Main Gate</label>
            <input className="input-field" value={roomForm.directionFromGate} onChange={(e) => setRoomForm({ ...roomForm, directionFromGate: e.target.value })} placeholder="e.g. Left wing, 2nd door" />
          </div>
          {(roomForm.type === "CHAMBER" || roomForm.type === "OFFICE") && (
            <div>
              <label className="block text-sm font-medium mb-1">Assigned Staff</label>
              <select className="input-field" value={roomForm.assignedStaffId} onChange={(e) => setRoomForm({ ...roomForm, assignedStaffId: e.target.value })}>
                <option value="">None</option>
                {staffList.map((s: any) => <option key={s.id} value={s.id}>{s.user?.name} ({s.designation})</option>)}
              </select>
            </div>
          )}
          {roomForm.type === "TEACHER_CHAMBER" && (
            <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              A Teacher Chamber is meant to be shared by multiple teachers at once. After saving this room, use its
              &quot;Cabins&quot; button on the room card below to add each teacher&apos;s own named cabin.
            </p>
          )}
          {(roomForm.type === "STAFF_ROOM" || roomForm.type === "TEACHER_CHAMBER") && (
            <div>
              <label className="block text-sm font-medium mb-1">Department</label>
              <input className="input-field" value={roomForm.department} onChange={(e) => setRoomForm({ ...roomForm, department: e.target.value })} placeholder="e.g. Science Department" />
            </div>
          )}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => { setRoomFloor(null); setEditingRoom(null); }} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={savingRoom} className="btn-primary disabled:opacity-50">{savingRoom ? "Saving..." : editingRoom ? "Save Changes" : "Add Room"}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={showOccupancy} onClose={() => setShowOccupancy(false)} title="Building Occupancy Summary" size="lg">
        {occupancyLoading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" />
          </div>
        ) : occupancy ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-primary-50 px-4 py-3 rounded-lg">
                <p className="text-xs text-primary-600">Total Rooms</p>
                <p className="text-lg font-bold text-primary-800">{occupancy.totalRooms}</p>
              </div>
              <div className="bg-green-50 px-4 py-3 rounded-lg">
                <p className="text-xs text-green-600">Classroom Seats</p>
                <p className="text-lg font-bold text-green-800">
                  {occupancy.classrooms.totalOccupied}/{occupancy.classrooms.totalCapacity}
                  <span className="text-xs font-normal text-gray-500 ml-1">({occupancy.classrooms.totalVacant} vacant)</span>
                </p>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-gray-600 mb-2">Room Type Breakdown</h4>
              <div className="flex flex-wrap gap-2">
                {Object.entries(occupancy.roomTypeBreakdown).map(([type, count]) => (
                  <span key={type} className="text-xs px-2 py-1 bg-gray-100 rounded-full">{type.replace(/_/g, " ")}: {count as number}</span>
                ))}
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-gray-600 mb-2">Classroom Detail</h4>
              {occupancy.classrooms.detail.length > 0 ? (
                <div className="overflow-x-auto max-h-72">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-gray-50">
                      <tr className="border-b">
                        <th className="px-3 py-2 text-left">Building</th>
                        <th className="px-3 py-2 text-left">Room</th>
                        <th className="px-3 py-2 text-left">Section(s)</th>
                        <th className="px-3 py-2 text-right">Occupied/Capacity</th>
                        <th className="px-3 py-2 text-right">Vacant</th>
                      </tr>
                    </thead>
                    <tbody>
                      {occupancy.classrooms.detail.map((r: any) => (
                        <tr key={r.roomId} className="border-b">
                          <td className="px-3 py-2">{r.buildingName}</td>
                          <td className="px-3 py-2 font-medium">{r.roomNo}</td>
                          <td className="px-3 py-2 text-gray-500">{r.sections.join(", ") || "-"}</td>
                          <td className={`px-3 py-2 text-right font-medium ${r.vacant === 0 ? "text-red-600" : "text-green-600"}`}>{r.occupied}/{r.capacity}</td>
                          <td className="px-3 py-2 text-right text-gray-500">{r.vacant}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-gray-400">No classroom-type rooms configured yet</p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-400 text-center py-6">Failed to load occupancy data</p>
        )}
        <div className="flex justify-end pt-4 border-t mt-4">
          <button type="button" onClick={() => setShowOccupancy(false)} className="btn-secondary">Close</button>
        </div>
      </Modal>
    </div>
  );
}
