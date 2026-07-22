"use client";

import { useState, useEffect } from "react";
import { CalendarCheck, Plus, Check, X } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

/**
 * Shared room booking (spec Section 4) - Conference Room/Auditorium
 * etc bookings requiring Principal approval.
 */
export default function RoomBookingsPage() {
  const { user } = useAuth();
  const canApprove = ["SUPER_ADMIN", "BRANCH_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL"].includes(user?.role || "");

  const [bookings, setBookings] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ roomId: "", purpose: "", startTime: "", endTime: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const fetchBookings = async () => {
    setLoading(true);
    try {
      const res = await api.get("/room-bookings");
      setBookings(res.data.data || []);
    } catch { setBookings([]); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetchBookings();
    api.get("/facilities/school-buildings/occupancy").then((res) => {
      const all = (res.data.data || []).flatMap((b: any) => b.floors?.flatMap((f: any) => f.rooms) || []);
      setRooms(all);
    }).catch(() => setRooms([]));
  }, []);

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.post("/room-bookings", form);
      setShowModal(false);
      setForm({ roomId: "", purpose: "", startTime: "", endTime: "" });
      fetchBookings();
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to request booking");
    } finally { setSaving(false); }
  };

  const respond = async (id: string, decision: "APPROVE" | "REJECT") => {
    try {
      await api.patch(`/room-bookings/${id}/respond`, { decision });
      fetchBookings();
    } catch (err: any) { alert(err.response?.data?.message || "Failed"); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <CalendarCheck className="h-6 w-6 text-primary-600" /> Room Bookings
          </h1>
          <p className="text-gray-500 mt-1">Book shared rooms (Conference Room, Auditorium, etc.) - requires Principal approval</p>
        </div>
        <button onClick={() => { setError(""); setShowModal(true); }} className="btn-primary flex items-center gap-1.5 text-sm">
          <Plus className="h-4 w-4" /> Request Booking
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>
      ) : bookings.length === 0 ? (
        <div className="card text-center py-12"><p className="text-gray-500">No room bookings yet.</p></div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="px-4 py-3 text-left">Room</th>
                <th className="px-4 py-3 text-left">Purpose</th>
                <th className="px-4 py-3 text-left">Time</th>
                <th className="px-4 py-3 text-left">Requested By</th>
                <th className="px-4 py-3 text-left">Status</th>
                {canApprove && <th className="px-4 py-3 text-left">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.id} className="border-b">
                  <td className="px-4 py-3">{b.room?.name || b.room?.roomNo}</td>
                  <td className="px-4 py-3">{b.purpose}</td>
                  <td className="px-4 py-3 text-xs">{new Date(b.startTime).toLocaleString()} - {new Date(b.endTime).toLocaleString()}</td>
                  <td className="px-4 py-3">{b.requestedBy?.user?.name}</td>
                  <td className="px-4 py-3"><span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100">{b.status}</span></td>
                  {canApprove && (
                    <td className="px-4 py-3 space-x-2">
                      {b.status === "PENDING" && (
                        <>
                          <button onClick={() => respond(b.id, "APPROVE")} className="p-1.5 text-green-600 hover:bg-green-50 rounded"><Check className="h-4 w-4" /></button>
                          <button onClick={() => respond(b.id, "REJECT")} className="p-1.5 text-red-600 hover:bg-red-50 rounded"><X className="h-4 w-4" /></button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full">
            <h2 className="text-lg font-bold mb-4">Request Room Booking</h2>
            <form onSubmit={handleRequest} className="space-y-4">
              {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>}
              <div>
                <label className="block text-sm font-medium mb-1">Room *</label>
                <select className="input-field" value={form.roomId} onChange={(e) => setForm({ ...form, roomId: e.target.value })} required>
                  <option value="">Select room</option>
                  {rooms.map((r: any) => <option key={r.id} value={r.id}>{r.name || r.roomNo}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Purpose *</label>
                <input className="input-field" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Start Time *</label>
                <input type="datetime-local" className="input-field" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">End Time *</label>
                <input type="datetime-local" className="input-field" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} required />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary disabled:opacity-50">{saving ? "Submitting..." : "Request"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
