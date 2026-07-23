"use client";

import { useState, useEffect } from "react";
import { Bus, Plus, MapPin, Trash2, IndianRupee, CheckCircle2, Users, Search, UserPlus, UserMinus, Signpost, Link2, Link2Off, Eye, Pencil, Navigation, ShieldAlert, Ruler, Wrench } from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";
import { formatCurrency, formatDate } from "@/lib/utils";
import { usePermissions } from "@/hooks/usePermissions";

// Own vs Rented + compliance-date fields exist on Vehicle (spec Section
// 11) but had no UI at all before this - see the "Add Vehicle" modal
// and vehicle card badges below.
const VEHICLE_TYPES = ["Bus", "Van", "Auto"];

/** "expired" (red) / "expiring" (amber, within 30 days) / "ok" (no badge needed) / null (no date set). */
function expiryStatus(date: string | null | undefined): "expired" | "expiring" | "ok" | null {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const daysLeft = (d.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  if (daysLeft < 0) return "expired";
  if (daysLeft <= 30) return "expiring";
  return "ok";
}

function ExpiryBadge({ label, date }: { label: string; date: string | null | undefined }) {
  const status = expiryStatus(date);
  if (!date) return null;
  const styles =
    status === "expired"
      ? "bg-red-100 text-red-700"
      : status === "expiring"
      ? "bg-amber-100 text-amber-700"
      : "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${styles}`}>
      {(status === "expired" || status === "expiring") && <ShieldAlert className="h-3 w-3" />}
      {label}: {formatDate(date)}
    </span>
  );
}

export default function TransportPage() {
  const { canDelete } = usePermissions();
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

  // Manage Students (allocate/remove students on a route) - this is
  // what actually populates TransportAllocation, which the "Assign Fee
  // to Allocated Students" button above depends on. Without this,
  // every route always shows "0 students" and that button stays
  // permanently disabled.
  const [manageRoute, setManageRoute] = useState<any>(null);
  const [studentSearch, setStudentSearch] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [allocatingId, setAllocatingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Add Stop (populates TransportStop for a route, shown as chips on
  // the route card above and usable as `stopName` when allocating
  // students). distanceFromStartKm/monthlyFeeOverride let a stop's fee
  // be set/derived per-stop instead of always using the route's flat
  // monthlyFee (spec Section 11 - "Fee: stop-wise / distance-wise, not
  // flat") - the backend already accepted these, the form just never
  // sent them.
  const [stopRoute, setStopRoute] = useState<any>(null);
  const [stopForm, setStopForm] = useState({ name: "", order: "", time: "", distanceFromStartKm: "", monthlyFeeOverride: "" });
  const [addingStop, setAddingStop] = useState(false);

  // Route distance + diesel-distance override (spec Section 11) - the
  // setRouteDistance endpoint existed with no UI at all.
  const [distanceRoute, setDistanceRoute] = useState<any>(null);
  const [distanceForm, setDistanceForm] = useState({ distance: "", dieselDistanceOverride: "" });
  const [savingDistance, setSavingDistance] = useState(false);

  // Add Vehicle - the addVehicle endpoint (with driver + ownership +
  // rental-fee + compliance-date fields) existed with NO form/modal in
  // the UI at all before this - vehicles could only be created via the
  // demo-data seeder or a direct API call.
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [vehicleForm, setVehicleForm] = useState({
    vehicleNo: "", type: "Bus", capacity: "",
    driverName: "", driverPhone: "", driverLicense: "",
    ownership: "OWN", monthlyFixedFee: "", perKmRate: "",
    insuranceExpiry: "", fitnessExpiry: "", pucExpiry: "",
  });
  const [savingVehicle, setSavingVehicle] = useState(false);

  // Maintenance log (fuel/service/repair) - logVehicleMaintenance /
  // getVehicleMaintenanceLogs existed with no UI at all before this.
  const [maintenanceVehicle, setMaintenanceVehicle] = useState<any>(null);
  const [maintenanceLogs, setMaintenanceLogs] = useState<any[]>([]);
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);
  const [maintenanceForm, setMaintenanceForm] = useState({ type: "", cost: "", odometerReading: "", notes: "" });
  const [savingMaintenance, setSavingMaintenance] = useState(false);

  // Live GPS locations panel (spec Section 11) - getVehicleLocations
  // existed with no UI at all before this.
  const [showLocations, setShowLocations] = useState(false);
  const [vehicleLocations, setVehicleLocations] = useState<any[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);

  // Assign/unassign a vehicle to route(s) - populates the VehicleRoute
  // join table, which previously had no endpoint that could ever
  // create a row in it at all (see BACKEND_UX_GAP_PLAN.md Phase 1).
  const [routeVehicle, setRouteVehicle] = useState<any>(null);
  const [selectedRouteId, setSelectedRouteId] = useState("");
  const [assigningRoute, setAssigningRoute] = useState(false);
  const [unassigningRouteId, setUnassigningRouteId] = useState<string | null>(null);

  // View Details - drills into a vehicle's driver phone/license (not
  // shown on the summary card) plus its assigned routes, via the new
  // getVehicleById endpoint.
  const [vehicleDetail, setVehicleDetail] = useState<any>(null);
  const [vehicleDetailLoading, setVehicleDetailLoading] = useState(false);

  const openVehicleDetail = async (id: string) => {
    setVehicleDetail({});
    setVehicleDetailLoading(true);
    try {
      const res = await api.get(`/facilities/transport/vehicles/${id}`);
      setVehicleDetail(res.data.data);
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to load vehicle details");
      setVehicleDetail(null);
    } finally {
      setVehicleDetailLoading(false);
    }
  };

  // Add/Edit Vehicle - one modal handles both (editingVehicleId is null
  // for "Add", or the vehicle's id for "Edit"). vehicleNo is only ever
  // sent on create - see updateVehicleSchema's doc comment on the
  // backend for why it's excluded from edits.
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);

  /** Converts a backend ISO datetime (or null) to a "YYYY-MM-DD" string for an <input type="date">. */
  const toDateInputValue = (date: string | null | undefined): string => {
    if (!date) return "";
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  };

  const openAddVehicleModal = () => {
    setEditingVehicleId(null);
    setVehicleForm({
      vehicleNo: "", type: "Bus", capacity: "",
      driverName: "", driverPhone: "", driverLicense: "",
      ownership: "OWN", monthlyFixedFee: "", perKmRate: "",
      insuranceExpiry: "", fitnessExpiry: "", pucExpiry: "",
    });
    setShowVehicleModal(true);
  };

  const openEditVehicleModal = (v: any) => {
    setEditingVehicleId(v.id);
    setVehicleForm({
      vehicleNo: v.vehicleNo || "",
      type: v.type || "Bus",
      capacity: v.capacity != null ? String(v.capacity) : "",
      driverName: v.driverName || "",
      driverPhone: v.driverPhone || "",
      driverLicense: v.driverLicense || "",
      ownership: v.ownership || "OWN",
      monthlyFixedFee: v.monthlyFixedFee != null ? String(v.monthlyFixedFee) : "",
      perKmRate: v.perKmRate != null ? String(v.perKmRate) : "",
      insuranceExpiry: toDateInputValue(v.insuranceExpiry),
      fitnessExpiry: toDateInputValue(v.fitnessExpiry),
      pucExpiry: toDateInputValue(v.pucExpiry),
    });
    setShowVehicleModal(true);
  };

  const handleSaveVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingVehicle(true);
    try {
      const payload: any = {
        type: vehicleForm.type,
        capacity: parseInt(vehicleForm.capacity, 10),
        driverName: vehicleForm.driverName || undefined,
        driverPhone: vehicleForm.driverPhone || undefined,
        driverLicense: vehicleForm.driverLicense || undefined,
        ownership: vehicleForm.ownership,
        monthlyFixedFee: vehicleForm.ownership === "RENTED" && vehicleForm.monthlyFixedFee ? parseFloat(vehicleForm.monthlyFixedFee) : undefined,
        perKmRate: vehicleForm.ownership === "RENTED" && vehicleForm.perKmRate ? parseFloat(vehicleForm.perKmRate) : undefined,
        insuranceExpiry: vehicleForm.insuranceExpiry || undefined,
        fitnessExpiry: vehicleForm.fitnessExpiry || undefined,
        pucExpiry: vehicleForm.pucExpiry || undefined,
      };
      if (editingVehicleId) {
        await api.patch(`/facilities/transport/vehicles/${editingVehicleId}`, payload);
      } else {
        await api.post("/facilities/transport/vehicles", { ...payload, vehicleNo: vehicleForm.vehicleNo });
      }
      setShowVehicleModal(false);
      await fetch();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to save vehicle");
    } finally {
      setSavingVehicle(false);
    }
  };

  // Maintenance log (fuel/service/repair)
  const openMaintenanceModal = async (v: any) => {
    setMaintenanceVehicle(v);
    setMaintenanceForm({ type: "", cost: "", odometerReading: "", notes: "" });
    setMaintenanceLoading(true);
    try {
      const res = await api.get(`/facilities/transport/vehicles/${v.id}/maintenance`);
      setMaintenanceLogs(res.data.data || []);
    } catch {
      setMaintenanceLogs([]);
    } finally {
      setMaintenanceLoading(false);
    }
  };

  const handleAddMaintenance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!maintenanceVehicle) return;
    setSavingMaintenance(true);
    try {
      await api.post("/facilities/transport/vehicles/maintenance", {
        vehicleId: maintenanceVehicle.id,
        type: maintenanceForm.type,
        cost: parseFloat(maintenanceForm.cost),
        odometerReading: maintenanceForm.odometerReading ? parseInt(maintenanceForm.odometerReading, 10) : undefined,
        notes: maintenanceForm.notes || undefined,
      });
      const res = await api.get(`/facilities/transport/vehicles/${maintenanceVehicle.id}/maintenance`);
      setMaintenanceLogs(res.data.data || []);
      setMaintenanceForm({ type: "", cost: "", odometerReading: "", notes: "" });
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to log maintenance");
    } finally {
      setSavingMaintenance(false);
    }
  };

  // Live GPS locations panel
  const openLocationsPanel = async () => {
    setShowLocations(true);
    setLocationsLoading(true);
    try {
      const res = await api.get("/facilities/transport/vehicles/locations");
      setVehicleLocations(res.data.data || []);
    } catch {
      setVehicleLocations([]);
    } finally {
      setLocationsLoading(false);
    }
  };

  // Route distance + diesel-distance override
  const openDistanceModal = (route: any) => {
    setDistanceRoute(route);
    setDistanceForm({
      distance: route.distance != null ? String(route.distance) : "",
      dieselDistanceOverride: route.dieselDistanceOverride != null ? String(route.dieselDistanceOverride) : "",
    });
  };

  const handleSaveDistance = async () => {
    if (!distanceRoute) return;
    setSavingDistance(true);
    try {
      await api.patch(`/facilities/transport/routes/${distanceRoute.id}/distance`, {
        distance: distanceForm.distance ? parseFloat(distanceForm.distance) : undefined,
        dieselDistanceOverride: distanceForm.dieselDistanceOverride ? parseFloat(distanceForm.dieselDistanceOverride) : undefined,
      });
      await fetch();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to update route distance");
    } finally {
      setSavingDistance(false);
    }
  };

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

  // Keep the open "Manage Students" modal in sync with the latest
  // fetched route data (e.g. right after allocating/removing a
  // student) instead of it going stale until the modal is reopened.
  useEffect(() => {
    if (manageRoute) {
      const fresh = routes.find((r) => r.id === manageRoute.id);
      if (fresh) setManageRoute(fresh);
    }
    if (stopRoute) {
      const fresh = routes.find((r) => r.id === stopRoute.id);
      if (fresh) setStopRoute(fresh);
    }
    if (routeVehicle) {
      const fresh = vehicles.find((v) => v.id === routeVehicle.id);
      if (fresh) setRouteVehicle(fresh);
    }
    if (distanceRoute) {
      const fresh = routes.find((r) => r.id === distanceRoute.id);
      if (fresh) setDistanceRoute(fresh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, vehicles]);

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

  const openManageModal = (route: any) => {
    setManageRoute(route);
    setStudentSearch("");
    setSearchResults([]);
  };

  const openStopModal = (route: any) => {
    setStopRoute(route);
    // Default the new stop's order to "one after the last stop" so
    // admins don't have to manually track the running sequence.
    const nextOrder = route.stops?.length ? Math.max(...route.stops.map((s: any) => s.order)) + 1 : 0;
    setStopForm({ name: "", order: String(nextOrder), time: "", distanceFromStartKm: "", monthlyFeeOverride: "" });
  };

  const handleAddStop = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stopRoute) return;
    setAddingStop(true);
    try {
      await api.post("/facilities/transport/stops", {
        routeId: stopRoute.id,
        name: stopForm.name,
        order: parseInt(stopForm.order, 10),
        time: stopForm.time,
        // Stop-wise / distance-wise fee (spec Section 11) - previously
        // never sent even though the backend already accepted them.
        distanceFromStartKm: stopForm.distanceFromStartKm ? parseFloat(stopForm.distanceFromStartKm) : undefined,
        monthlyFeeOverride: stopForm.monthlyFeeOverride ? parseFloat(stopForm.monthlyFeeOverride) : undefined,
      });
      await fetch();
      setStopForm((f) => ({ name: "", order: String((parseInt(f.order, 10) || 0) + 1), time: "", distanceFromStartKm: "", monthlyFeeOverride: "" }));
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to add stop");
    } finally {
      setAddingStop(false);
    }
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

  const allocateToRoute = async (studentId: string) => {
    if (!manageRoute) return;
    setAllocatingId(studentId);
    try {
      await api.post("/facilities/transport/allocate", { studentId, routeId: manageRoute.id });
      await fetch();
      setSearchResults([]);
      setStudentSearch("");
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to allocate student to route");
    } finally {
      setAllocatingId(null);
    }
  };

  const removeFromRoute = async (studentId: string, name: string) => {
    if (!confirm(`Remove ${name} from this route?`)) return;
    setRemovingId(studentId);
    try {
      await api.delete(`/facilities/transport/allocate/${studentId}`);
      await fetch();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to remove student from route");
    } finally {
      setRemovingId(null);
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

  const openRouteModal = (vehicle: any) => {
    setRouteVehicle(vehicle);
    setSelectedRouteId("");
  };

  const handleAssignRoute = async () => {
    if (!routeVehicle || !selectedRouteId) return;
    setAssigningRoute(true);
    try {
      await api.post("/facilities/transport/vehicle-routes", { vehicleId: routeVehicle.id, routeId: selectedRouteId });
      await fetch();
      setSelectedRouteId("");
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to assign route to vehicle");
    } finally {
      setAssigningRoute(false);
    }
  };

  const handleUnassignRoute = async (routeId: string) => {
    if (!routeVehicle) return;
    setUnassigningRouteId(routeId);
    try {
      await api.delete(`/facilities/transport/vehicle-routes/${routeVehicle.id}/${routeId}`);
      await fetch();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to unassign route from vehicle");
    } finally {
      setUnassigningRouteId(null);
    }
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
        <div className="flex items-center gap-2">
          <button onClick={openLocationsPanel} className="btn-secondary flex items-center gap-2"><Navigation className="h-4 w-4" /> Live Locations</button>
          <button onClick={openAddVehicleModal} className="btn-secondary flex items-center gap-2"><Plus className="h-4 w-4" /> Add Vehicle</button>
          <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2"><Plus className="h-4 w-4" /> Add Route</button>
        </div>
      </div>

      {loading ? <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div> : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {routes.map(r => (
              <div key={r.id} className="card">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-gray-900">{r.name}</h3>
                  {canDelete && (
                    <button onClick={() => deleteRoute(r.id, r.name)} title="Delete Route" className="text-red-400 hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-500 mb-2"><MapPin className="h-4 w-4" /> {r.startPoint} → {r.endPoint}</div>
                <div className="flex justify-between text-sm">
                  <span className="text-green-700 font-medium">{formatCurrency(r.monthlyFee)}/month</span>
                  <span className="text-gray-500">{r._count?.allocations || 0} students</span>
                </div>
                {/* Route distance + diesel-distance override (spec Section 11) - previously set-only via a direct API call, never shown or editable here. */}
                <div className="flex items-center gap-1 text-xs text-gray-400 mt-1">
                  <Ruler className="h-3 w-3" />
                  {r.distance != null ? `${r.distance} km` : "Distance not set"}
                  {r.dieselDistanceOverride != null && ` (diesel calc: ${r.dieselDistanceOverride} km)`}
                </div>
                {r.stops?.length > 0 && (
                  <div className="mt-3 pt-2 border-t"><p className="text-xs text-gray-400 mb-1">Stops ({r.stops.length}):</p>
                    <div className="flex flex-wrap gap-1">{r.stops.map((s: any) => <span key={s.id} className="text-xs px-2 py-0.5 bg-gray-100 rounded">{s.name}</span>)}</div>
                  </div>
                )}
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <button
                    onClick={() => openManageModal(r)}
                    className="text-xs font-medium text-gray-600 hover:text-gray-800 border border-gray-200 hover:bg-gray-50 rounded-lg py-1.5 flex items-center justify-center gap-1"
                  >
                    <Users className="h-3.5 w-3.5" /> Students
                  </button>
                  <button
                    onClick={() => openStopModal(r)}
                    className="text-xs font-medium text-gray-600 hover:text-gray-800 border border-gray-200 hover:bg-gray-50 rounded-lg py-1.5 flex items-center justify-center gap-1"
                  >
                    <Signpost className="h-3.5 w-3.5" /> Add Stop
                  </button>
                  <button
                    onClick={() => openDistanceModal(r)}
                    className="text-xs font-medium text-gray-600 hover:text-gray-800 border border-gray-200 hover:bg-gray-50 rounded-lg py-1.5 flex items-center justify-center gap-1"
                  >
                    <Ruler className="h-3.5 w-3.5" /> Distance
                  </button>
                </div>
                <button
                  onClick={() => openAssignModal(r)}
                  disabled={!r._count?.allocations}
                  title={!r._count?.allocations ? "No students allocated to this route yet" : "Assign this route's fee to every allocated student"}
                  className="mt-2 w-full text-xs font-medium text-primary-600 hover:text-primary-700 border border-primary-200 hover:bg-primary-50 rounded-lg py-1.5 flex items-center justify-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
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
                  <div key={v.id} className="bg-gray-50 p-3 rounded-lg text-sm">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{v.vehicleNo}</p>
                          {/* Own vs Rented (spec Section 11) - never shown anywhere before this. */}
                          <span className={`text-xs px-1.5 py-0.5 rounded ${v.ownership === "RENTED" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>
                            {v.ownership === "RENTED" ? "Rented" : "Own"}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500">{v.type} | Capacity: {v.capacity}</p>
                        {v.driverName && <p className="text-xs text-gray-400">Driver: {v.driverName}{v.driverPhone ? ` (${v.driverPhone})` : ""}</p>}
                        {v.ownership === "RENTED" && (v.monthlyFixedFee || v.perKmRate) && (
                          <p className="text-xs text-gray-400">
                            {v.monthlyFixedFee && `Fixed: ${formatCurrency(v.monthlyFixedFee)}/mo`}
                            {v.monthlyFixedFee && v.perKmRate && " | "}
                            {v.perKmRate && `${formatCurrency(v.perKmRate)}/km`}
                          </p>
                        )}
                      </div>
                      {canDelete && (
                        <button onClick={() => deleteVehicle(v.id, v.vehicleNo)} title="Delete Vehicle" className="text-red-400 hover:text-red-600">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    {/* Compliance-date expiry badges (spec Section 11) - never shown anywhere before this. */}
                    {(v.insuranceExpiry || v.fitnessExpiry || v.pucExpiry) && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        <ExpiryBadge label="Insurance" date={v.insuranceExpiry} />
                        <ExpiryBadge label="Fitness" date={v.fitnessExpiry} />
                        <ExpiryBadge label="PUC" date={v.pucExpiry} />
                      </div>
                    )}
                    {v.routes?.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {v.routes.map((vr: any) => (
                          <span key={vr.id} className="text-xs px-2 py-0.5 bg-white border border-gray-200 rounded-full text-gray-600">{vr.route.name}</span>
                        ))}
                      </div>
                    )}
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button
                        onClick={() => openVehicleDetail(v.id)}
                        className="text-xs font-medium text-gray-600 hover:text-gray-800 border border-gray-200 hover:bg-gray-100 bg-white rounded-lg py-1 flex items-center justify-center gap-1"
                      >
                        <Eye className="h-3.5 w-3.5" /> Details
                      </button>
                      <button
                        onClick={() => openRouteModal(v)}
                        className="text-xs font-medium text-gray-600 hover:text-gray-800 border border-gray-200 hover:bg-gray-100 bg-white rounded-lg py-1 flex items-center justify-center gap-1"
                      >
                        <Link2 className="h-3.5 w-3.5" /> Routes
                      </button>
                      <button
                        onClick={() => openEditVehicleModal(v)}
                        className="text-xs font-medium text-gray-600 hover:text-gray-800 border border-gray-200 hover:bg-gray-100 bg-white rounded-lg py-1 flex items-center justify-center gap-1"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </button>
                      <button
                        onClick={() => openMaintenanceModal(v)}
                        className="text-xs font-medium text-gray-600 hover:text-gray-800 border border-gray-200 hover:bg-gray-100 bg-white rounded-lg py-1 flex items-center justify-center gap-1"
                      >
                        <Wrench className="h-3.5 w-3.5" /> Maintenance
                      </button>
                    </div>
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

      <Modal isOpen={!!manageRoute} onClose={() => setManageRoute(null)} title={`Manage Students - ${manageRoute?.name || ""}`} size="lg">
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-semibold text-gray-600 mb-2">
              Allocated Students ({manageRoute?.allocations?.length || 0})
            </h4>
            {manageRoute?.allocations?.length > 0 ? (
              <div className="space-y-2 max-h-56 overflow-y-auto">
                {manageRoute.allocations.map((a: any) => (
                  <div key={a.student.id} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded-lg text-sm">
                    <div>
                      <p className="font-medium">{a.student.user.name}</p>
                      <p className="text-xs text-gray-500">
                        {a.student.admissionNo} &bull; {a.student.class?.name}{a.student.section?.name ? `-${a.student.section.name}` : ""}
                        {a.stopName ? ` \u2022 Stop: ${a.stopName}` : ""}
                      </p>
                    </div>
                    {canDelete && (
                      <button
                        onClick={() => removeFromRoute(a.student.id, a.student.user.name)}
                        disabled={removingId === a.student.id}
                        title="Remove from route"
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded disabled:opacity-40"
                      >
                        <UserMinus className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">No students allocated yet - search below to add some.</p>
            )}
          </div>

          <div className="pt-3 border-t">
            <h4 className="text-sm font-semibold text-gray-600 mb-2">Add Student</h4>
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
              <button type="button" onClick={searchStudents} className="btn-secondary text-sm">Search</button>
            </div>

            {searchLoading ? (
              <div className="flex justify-center py-4">
                <div className="animate-spin h-5 w-5 border-4 border-primary-600 border-t-transparent rounded-full" />
              </div>
            ) : searchResults.length > 0 ? (
              <div className="space-y-2 max-h-56 overflow-y-auto">
                {searchResults.map((s: any) => {
                  const alreadyOnThisRoute = manageRoute?.allocations?.some((a: any) => a.student.id === s.id);
                  return (
                    <div key={s.id} className="flex items-center justify-between border px-3 py-2 rounded-lg text-sm">
                      <div>
                        <p className="font-medium">{s.user?.name}</p>
                        <p className="text-xs text-gray-500">{s.admissionNo} &bull; {s.class?.name}{s.section?.name ? `-${s.section.name}` : ""}</p>
                      </div>
                      <button
                        onClick={() => allocateToRoute(s.id)}
                        disabled={alreadyOnThisRoute || allocatingId === s.id}
                        title={alreadyOnThisRoute ? "Already allocated to this route" : "Allocate to this route"}
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <UserPlus className="h-3.5 w-3.5" /> {alreadyOnThisRoute ? "Added" : allocatingId === s.id ? "Adding..." : "Add"}
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : studentSearch.trim() ? (
              <p className="text-sm text-gray-400">No students found</p>
            ) : null}
          </div>

          <div className="flex justify-end pt-4 border-t">
            <button type="button" onClick={() => setManageRoute(null)} className="btn-secondary">Close</button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!stopRoute} onClose={() => setStopRoute(null)} title={`Manage Stops - ${stopRoute?.name || ""}`}>
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-semibold text-gray-600 mb-2">
              Existing Stops ({stopRoute?.stops?.length || 0})
            </h4>
            {stopRoute?.stops?.length > 0 ? (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {[...(stopRoute.stops as any[])].sort((a, b) => a.order - b.order).map((s: any) => (
                  <div key={s.id} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded-lg text-sm">
                    <span className="flex items-center gap-2">
                      <span className="text-xs font-mono text-gray-400 w-6">#{s.order}</span>
                      <span className="font-medium">{s.name}</span>
                      {/* Stop-wise fee/distance (spec Section 11) - never shown anywhere before this. */}
                      {s.distanceFromStartKm != null && <span className="text-xs text-gray-400">{s.distanceFromStartKm} km</span>}
                      {s.monthlyFeeOverride != null && <span className="text-xs text-green-700">{formatCurrency(s.monthlyFeeOverride)}/mo</span>}
                    </span>
                    <span className="text-xs text-gray-500">{s.time}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">No stops added yet for this route.</p>
            )}
          </div>

          <form onSubmit={handleAddStop} className="pt-3 border-t space-y-3">
            <h4 className="text-sm font-semibold text-gray-600">Add Stop</h4>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-1">
                <label className="block text-sm font-medium mb-1">Stop Name *</label>
                <input className="input-field" value={stopForm.name} onChange={(e) => setStopForm({ ...stopForm, name: e.target.value })} required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Order *</label>
                <input type="number" min={0} className="input-field" value={stopForm.order} onChange={(e) => setStopForm({ ...stopForm, order: e.target.value })} required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Time *</label>
                <input type="time" className="input-field" value={stopForm.time} onChange={(e) => setStopForm({ ...stopForm, time: e.target.value })} required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Distance from Start (km)</label>
                <input type="number" step="0.01" min={0} className="input-field" value={stopForm.distanceFromStartKm} onChange={(e) => setStopForm({ ...stopForm, distanceFromStartKm: e.target.value })} placeholder="Optional" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Monthly Fee Override (Rs)</label>
                <input type="number" step="0.01" min={0} className="input-field" value={stopForm.monthlyFeeOverride} onChange={(e) => setStopForm({ ...stopForm, monthlyFeeOverride: e.target.value })} placeholder={`Defaults to route's ${formatCurrency(stopRoute?.monthlyFee || 0)}`} />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setStopRoute(null)} className="btn-secondary">Close</button>
              <button type="submit" disabled={addingStop} className="btn-primary disabled:opacity-50">
                {addingStop ? "Adding..." : "Add Stop"}
              </button>
            </div>
          </form>
        </div>
      </Modal>

      <Modal isOpen={!!distanceRoute} onClose={() => setDistanceRoute(null)} title={`Route Distance - ${distanceRoute?.name || ""}`}>
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Set the measured distance for this route, and optionally a separate distance used only for diesel-cost calculations
            (if it differs from the route's actual distance).
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Distance (km)</label>
              <input type="number" step="0.01" min={0} className="input-field" value={distanceForm.distance} onChange={(e) => setDistanceForm({ ...distanceForm, distance: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Diesel-Calc Distance Override (km)</label>
              <input type="number" step="0.01" min={0} className="input-field" value={distanceForm.dieselDistanceOverride} onChange={(e) => setDistanceForm({ ...distanceForm, dieselDistanceOverride: e.target.value })} placeholder="Optional" />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setDistanceRoute(null)} className="btn-secondary">Close</button>
            <button type="button" onClick={handleSaveDistance} disabled={savingDistance} className="btn-primary disabled:opacity-50">
              {savingDistance ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showVehicleModal} onClose={() => setShowVehicleModal(false)} title={editingVehicleId ? "Edit Vehicle" : "Add Vehicle"}>
        <form onSubmit={handleSaveVehicle} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Vehicle No *</label>
              <input
                className="input-field disabled:bg-gray-100"
                value={vehicleForm.vehicleNo}
                onChange={(e) => setVehicleForm({ ...vehicleForm, vehicleNo: e.target.value })}
                disabled={!!editingVehicleId}
                title={editingVehicleId ? "Vehicle number cannot be changed after creation" : undefined}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Type *</label>
              <select className="input-field" value={vehicleForm.type} onChange={(e) => setVehicleForm({ ...vehicleForm, type: e.target.value })} required>
                {VEHICLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          <div><label className="block text-sm font-medium mb-1">Capacity *</label><input type="number" min={1} className="input-field" value={vehicleForm.capacity} onChange={(e) => setVehicleForm({ ...vehicleForm, capacity: e.target.value })} required /></div>

          <div className="pt-2 border-t">
            <h4 className="text-sm font-semibold text-gray-600 mb-2">Driver Details</h4>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="block text-sm font-medium mb-1">Name</label><input className="input-field" value={vehicleForm.driverName} onChange={(e) => setVehicleForm({ ...vehicleForm, driverName: e.target.value })} /></div>
              <div><label className="block text-sm font-medium mb-1">Phone</label><input className="input-field" value={vehicleForm.driverPhone} onChange={(e) => setVehicleForm({ ...vehicleForm, driverPhone: e.target.value })} /></div>
              <div><label className="block text-sm font-medium mb-1">License No</label><input className="input-field" value={vehicleForm.driverLicense} onChange={(e) => setVehicleForm({ ...vehicleForm, driverLicense: e.target.value })} /></div>
            </div>
          </div>

          <div className="pt-2 border-t">
            <h4 className="text-sm font-semibold text-gray-600 mb-2">Ownership</h4>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Own / Rented</label>
                <select className="input-field" value={vehicleForm.ownership} onChange={(e) => setVehicleForm({ ...vehicleForm, ownership: e.target.value })}>
                  <option value="OWN">Own</option>
                  <option value="RENTED">Rented</option>
                </select>
              </div>
              {vehicleForm.ownership === "RENTED" && (
                <>
                  <div><label className="block text-sm font-medium mb-1">Monthly Fixed Fee (Rs)</label><input type="number" step="0.01" min={0} className="input-field" value={vehicleForm.monthlyFixedFee} onChange={(e) => setVehicleForm({ ...vehicleForm, monthlyFixedFee: e.target.value })} /></div>
                  <div><label className="block text-sm font-medium mb-1">Per-Km Rate (Rs)</label><input type="number" step="0.01" min={0} className="input-field" value={vehicleForm.perKmRate} onChange={(e) => setVehicleForm({ ...vehicleForm, perKmRate: e.target.value })} /></div>
                </>
              )}
            </div>
          </div>

          <div className="pt-2 border-t">
            <h4 className="text-sm font-semibold text-gray-600 mb-2">Compliance Dates</h4>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="block text-sm font-medium mb-1">Insurance Expiry</label><input type="date" className="input-field" value={vehicleForm.insuranceExpiry} onChange={(e) => setVehicleForm({ ...vehicleForm, insuranceExpiry: e.target.value })} /></div>
              <div><label className="block text-sm font-medium mb-1">Fitness Expiry</label><input type="date" className="input-field" value={vehicleForm.fitnessExpiry} onChange={(e) => setVehicleForm({ ...vehicleForm, fitnessExpiry: e.target.value })} /></div>
              <div><label className="block text-sm font-medium mb-1">PUC Expiry</label><input type="date" className="input-field" value={vehicleForm.pucExpiry} onChange={(e) => setVehicleForm({ ...vehicleForm, pucExpiry: e.target.value })} /></div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setShowVehicleModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={savingVehicle} className="btn-primary disabled:opacity-50">
              {savingVehicle ? "Saving..." : editingVehicleId ? "Save Changes" : "Add Vehicle"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!maintenanceVehicle} onClose={() => setMaintenanceVehicle(null)} title={`Maintenance Log - ${maintenanceVehicle?.vehicleNo || ""}`} size="lg">
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-semibold text-gray-600 mb-2">History</h4>
            {maintenanceLoading ? (
              <div className="flex justify-center py-4"><div className="animate-spin h-5 w-5 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
            ) : maintenanceLogs.length > 0 ? (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {maintenanceLogs.map((log: any) => (
                  <div key={log.id} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded-lg text-sm">
                    <div>
                      <p className="font-medium">{log.type}</p>
                      <p className="text-xs text-gray-500">
                        {formatDate(log.loggedAt)}
                        {log.odometerReading != null && ` \u2022 ${log.odometerReading} km`}
                        {log.notes && ` \u2022 ${log.notes}`}
                      </p>
                    </div>
                    <span className="text-sm font-medium text-red-600">{formatCurrency(log.cost)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">No maintenance/fuel entries logged yet.</p>
            )}
          </div>

          <form onSubmit={handleAddMaintenance} className="pt-3 border-t space-y-3">
            <h4 className="text-sm font-semibold text-gray-600">Log New Entry</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Type *</label>
                <input className="input-field" placeholder="Service, Repair, Fuel, Tyre Change..." value={maintenanceForm.type} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, type: e.target.value })} required />
              </div>
              <div><label className="block text-sm font-medium mb-1">Cost (Rs) *</label><input type="number" step="0.01" min={0} className="input-field" value={maintenanceForm.cost} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, cost: e.target.value })} required /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-sm font-medium mb-1">Odometer Reading (km)</label><input type="number" min={0} className="input-field" value={maintenanceForm.odometerReading} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, odometerReading: e.target.value })} /></div>
              <div><label className="block text-sm font-medium mb-1">Notes</label><input className="input-field" value={maintenanceForm.notes} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, notes: e.target.value })} /></div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setMaintenanceVehicle(null)} className="btn-secondary">Close</button>
              <button type="submit" disabled={savingMaintenance} className="btn-primary disabled:opacity-50">
                {savingMaintenance ? "Logging..." : "Log Entry"}
              </button>
            </div>
          </form>
        </div>
      </Modal>

      <Modal isOpen={showLocations} onClose={() => setShowLocations(false)} title="Live Vehicle Locations" size="lg">
        <div className="space-y-2">
          {locationsLoading ? (
            <div className="flex justify-center py-8"><div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
          ) : vehicleLocations.length > 0 ? (
            vehicleLocations.map((v: any) => (
              <div key={v.id} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded-lg text-sm">
                <span className="font-medium flex items-center gap-2"><Navigation className="h-3.5 w-3.5 text-gray-400" /> {v.vehicleNo}</span>
                {v.lastLat != null && v.lastLng != null ? (
                  <span className="text-xs text-gray-500">
                    {v.lastLat}, {v.lastLng}
                    {v.lastLocationAt && ` \u2022 as of ${formatDate(v.lastLocationAt)}`}
                  </span>
                ) : (
                  <span className="text-xs text-gray-400">No location reported yet</span>
                )}
              </div>
            ))
          ) : (
            <p className="text-sm text-gray-400">No active vehicles found.</p>
          )}
          <div className="flex justify-end pt-4 border-t">
            <button type="button" onClick={() => setShowLocations(false)} className="btn-secondary">Close</button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!routeVehicle} onClose={() => setRouteVehicle(null)} title={`Manage Routes - ${routeVehicle?.vehicleNo || ""}`}>
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-semibold text-gray-600 mb-2">
              Assigned Routes ({routeVehicle?.routes?.length || 0})
            </h4>
            {routeVehicle?.routes?.length > 0 ? (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {routeVehicle.routes.map((vr: any) => (
                  <div key={vr.id} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded-lg text-sm">
                    <span className="font-medium">{vr.route.name}</span>
                    {canDelete && (
                      <button
                        onClick={() => handleUnassignRoute(vr.route.id)}
                        disabled={unassigningRouteId === vr.route.id}
                        title="Unassign this route"
                        className="p-1 text-red-500 hover:bg-red-50 rounded disabled:opacity-40"
                      >
                        <Link2Off className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">This vehicle is not assigned to any route yet.</p>
            )}
          </div>

          <div className="pt-3 border-t space-y-3">
            <h4 className="text-sm font-semibold text-gray-600">Assign a Route</h4>
            <div className="flex gap-2">
              <select className="input-field flex-1" value={selectedRouteId} onChange={(e) => setSelectedRouteId(e.target.value)}>
                <option value="">Select a route</option>
                {routes
                  .filter((r) => !routeVehicle?.routes?.some((vr: any) => vr.route.id === r.id))
                  .map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <button type="button" onClick={handleAssignRoute} disabled={!selectedRouteId || assigningRoute} className="btn-primary text-sm disabled:opacity-50">
                {assigningRoute ? "Assigning..." : "Assign"}
              </button>
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t">
            <button type="button" onClick={() => setRouteVehicle(null)} className="btn-secondary">Close</button>
          </div>
        </div>
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

      <Modal isOpen={!!vehicleDetail} onClose={() => setVehicleDetail(null)} title={vehicleDetail?.vehicleNo ? `Vehicle - ${vehicleDetail.vehicleNo}` : "Vehicle Details"}>
        {vehicleDetailLoading ? (
          <div className="flex justify-center py-8"><div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
        ) : vehicleDetail ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-gray-500">Type</p><p className="font-medium">{vehicleDetail.type}</p></div>
              <div><p className="text-gray-500">Capacity</p><p className="font-medium">{vehicleDetail.capacity}</p></div>
              <div><p className="text-gray-500">Driver Name</p><p className="font-medium">{vehicleDetail.driverName || "-"}</p></div>
              <div><p className="text-gray-500">Driver Phone</p><p className="font-medium">{vehicleDetail.driverPhone || "-"}</p></div>
              <div><p className="text-gray-500">Driver License</p><p className="font-medium">{vehicleDetail.driverLicense || "-"}</p></div>
              <div><p className="text-gray-500">Status</p><p className="font-medium">{vehicleDetail.isActive ? "Active" : "Inactive"}</p></div>
              <div><p className="text-gray-500">Ownership</p><p className="font-medium">{vehicleDetail.ownership === "RENTED" ? "Rented" : "Own"}</p></div>
              {vehicleDetail.ownership === "RENTED" && (
                <div><p className="text-gray-500">Rental Terms</p><p className="font-medium">
                  {vehicleDetail.monthlyFixedFee ? `${formatCurrency(vehicleDetail.monthlyFixedFee)}/mo` : "-"}
                  {vehicleDetail.perKmRate ? ` + ${formatCurrency(vehicleDetail.perKmRate)}/km` : ""}
                </p></div>
              )}
            </div>
            <div>
              <h4 className="text-sm font-semibold text-gray-600 mb-2">Compliance</h4>
              <div className="flex flex-wrap gap-1.5">
                <ExpiryBadge label="Insurance" date={vehicleDetail.insuranceExpiry} />
                <ExpiryBadge label="Fitness" date={vehicleDetail.fitnessExpiry} />
                <ExpiryBadge label="PUC" date={vehicleDetail.pucExpiry} />
                {!vehicleDetail.insuranceExpiry && !vehicleDetail.fitnessExpiry && !vehicleDetail.pucExpiry && (
                  <p className="text-sm text-gray-400">No compliance dates set.</p>
                )}
              </div>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-gray-600 mb-2">Assigned Routes</h4>
              {vehicleDetail.routes?.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {vehicleDetail.routes.map((vr: any) => (
                    <span key={vr.route.id} className="text-xs px-2 py-1 bg-gray-100 rounded-full">{vr.route.name}</span>
                  ))}
                </div>
              ) : <p className="text-sm text-gray-400">Not assigned to any route yet.</p>}
            </div>
            <div className="flex justify-end pt-2 border-t">
              <button type="button" onClick={() => setVehicleDetail(null)} className="btn-secondary">Close</button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
