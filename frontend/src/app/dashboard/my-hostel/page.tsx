"use client";

import { useEffect, useState } from "react";
import { Home, MapPin, Users, CheckCircle2, XCircle, Clock, Search } from "lucide-react";
import api from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useChildren } from "@/hooks/useChildren";
import { useAuth } from "@/hooks/useAuth";
import ChildSwitcher from "@/components/parent/ChildSwitcher";
import ErrorBanner from "@/components/ui/ErrorBanner";

/**
 * Student/Parent self-service hostel page (spec Section 13) - the
 * backend has fully supported this flow (requestBed,
 * respondToRoomRequest, getSuggestedRooms) since it was first added,
 * but there was NO frontend surface for it at all: a student could
 * only ever be placed into a room by a Warden manually using the
 * staff-side Hostel page. This is the missing self-service half.
 *
 * Uses the same child-switcher pattern as my-fees/my-attendance/etc -
 * see useChildren's doc comment for why a STUDENT login always has
 * exactly one "child" (themselves).
 */
export default function MyHostelPage() {
  const { user } = useAuth();
  const { children, selectedChildId, fetchChildren } = useChildren();
  const [status, setStatus] = useState<any>(null);
  const [requests, setRequests] = useState<{ asRequester: any[]; asRoommate: any[] }>({ asRequester: [], asRoommate: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  // Request-a-bed flow
  const [suggested, setSuggested] = useState<any[]>([]);
  const [suggestedLoading, setSuggestedLoading] = useState(false);
  const [customRoomId, setCustomRoomId] = useState("");
  const [requesting, setRequestingId] = useState<string | null>(null);

  const selectedChild = children.find((c) => c.id === selectedChildId);

  useEffect(() => {
    fetchChildren();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusRes, requestsRes] = await Promise.all([
        api.get("/facilities/hostel/my-status"),
        api.get("/facilities/hostel/room-requests"),
      ]);
      setStatus(statusRes.data.data);
      setRequests(requestsRes.data.data || { asRequester: [], asRoommate: [] });
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to load hostel status");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedChildId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChildId]);

  const loadSuggested = async () => {
    setSuggestedLoading(true);
    try {
      const res = await api.get("/facilities/hostel/suggested-rooms");
      setSuggested(res.data.data || []);
    } catch {
      setSuggested([]);
    } finally {
      setSuggestedLoading(false);
    }
  };

  // Only worth showing the "request a bed" flow once we know the
  // student doesn't already have one, and don't already have a
  // pending outgoing request sitting unanswered.
  const pendingOutgoing = requests.asRequester.find((r) => r.status === "PENDING");
  const canRequestBed = !status && !pendingOutgoing;

  useEffect(() => {
    if (canRequestBed) loadSuggested();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRequestBed, selectedChildId]);

  const requestRoom = async (roomId: string) => {
    if (!selectedChildId) return;
    setRequestingId(roomId);
    try {
      const res = await api.post("/facilities/hostel/request-bed", { studentId: selectedChildId, roomId });
      alert(res.data.message);
      setCustomRoomId("");
      await load();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to request bed");
    } finally {
      setRequestingId(null);
    }
  };

  const respond = async (requestId: string, decision: "APPROVE" | "REJECT") => {
    setRespondingId(requestId);
    try {
      const res = await api.patch(`/facilities/hostel/room-requests/${requestId}/respond`, { decision });
      alert(res.data.message);
      await load();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to respond to request");
    } finally {
      setRespondingId(null);
    }
  };

  const statusBadge = (s: string) => {
    const styles: Record<string, string> = {
      PENDING: "bg-amber-100 text-amber-700",
      APPROVED: "bg-green-100 text-green-700",
      REJECTED: "bg-red-100 text-red-700",
    };
    return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[s] || "bg-gray-100 text-gray-600"}`}>{s}</span>;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Home className="h-6 w-6 text-primary-600" /> My Hostel
          </h1>
          <p className="text-gray-500 mt-1">
            {user?.role === "PARENT" ? "View and manage your child's hostel room" : "View and manage your hostel room"}
          </p>
        </div>
        <ChildSwitcher />
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
        </div>
      ) : !selectedChildId ? null : (
        <div className="space-y-6">
          {/* Current status */}
          {status ? (
            <div className="card bg-gradient-to-r from-primary-600 to-primary-700 text-white">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <p className="text-sm opacity-80">Current Room</p>
                  <p className="text-2xl font-bold mt-1 flex items-center gap-2">
                    <MapPin className="h-5 w-5" /> {status.room.floor.building.name} - Room {status.room.roomNo}
                    {status.bedNo ? ` (Bed ${status.bedNo})` : ""}
                  </p>
                  <p className="text-sm opacity-80 mt-1">
                    {status.room.type} &bull; {formatCurrency(status.room.monthlyFee)}/month &bull; since {formatDate(status.startDate)}
                  </p>
                </div>
                {status.isProvisional && (
                  <span className="flex items-center gap-1 bg-white/20 text-xs font-medium px-3 py-1.5 rounded-full">
                    <Clock className="h-3.5 w-3.5" /> Provisional - awaiting Warden's final approval
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="card bg-gray-50 border border-gray-200">
              <p className="text-gray-600">No hostel room allotted yet.</p>
            </div>
          )}

          {/* Incoming roommate requests needing my response */}
          {requests.asRoommate.length > 0 && (
            <div className="card">
              <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <Users className="h-5 w-5 text-amber-600" /> Someone wants to join your room
              </h3>
              <div className="space-y-3">
                {requests.asRoommate.map((r: any) => (
                  <div key={r.id} className="border rounded-lg p-4 flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <p className="font-medium">{r.student?.user?.name}</p>
                      <p className="text-xs text-gray-500">wants to move into {r.room.floor.building.name} - Room {r.room.roomNo}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => respond(r.id, "APPROVE")}
                        disabled={respondingId === r.id}
                        className="btn-primary text-sm flex items-center gap-1 disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-4 w-4" /> Approve
                      </button>
                      <button
                        onClick={() => respond(r.id, "REJECT")}
                        disabled={respondingId === r.id}
                        className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50"
                      >
                        <XCircle className="h-4 w-4" /> Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* My own outgoing request history */}
          {requests.asRequester.length > 0 && (
            <div className="card">
              <h3 className="text-lg font-semibold mb-3">My Room Requests</h3>
              <div className="space-y-2">
                {requests.asRequester.map((r: any) => (
                  <div key={r.id} className="flex items-center justify-between border-b last:border-b-0 pb-2 last:pb-0 text-sm">
                    <span>{r.room.floor.building.name} - Room {r.room.roomNo} ({formatDate(r.createdAt)})</span>
                    {statusBadge(r.status)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Request a bed - only shown if not already allotted and no
              pending outgoing request awaiting an answer. */}
          {canRequestBed && (
            <div className="card">
              <h3 className="text-lg font-semibold mb-1">Request a Bed</h3>
              <p className="text-sm text-gray-500 mb-4">
                Pick a suggested room below (auto-allotted if empty, or sent to the current occupant for approval if
                already occupied), or enter a specific room ID if you already know which one you want.
              </p>

              {suggestedLoading ? (
                <div className="flex justify-center py-6">
                  <div className="animate-spin h-6 w-6 border-4 border-primary-600 border-t-transparent rounded-full" />
                </div>
              ) : suggested.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                  {suggested.map((room: any) => (
                    <div key={room.id} className="border rounded-lg p-3 flex items-center justify-between">
                      <div>
                        <p className="font-medium">{room.floor.building.name} - Room {room.roomNo}</p>
                        <p className="text-xs text-gray-500">
                          {room.type} &bull; {room.occupied}/{room.capacity} occupied &bull; {formatCurrency(room.monthlyFee)}/month
                        </p>
                      </div>
                      <button
                        onClick={() => requestRoom(room.id)}
                        disabled={requesting === room.id}
                        className="btn-primary text-sm disabled:opacity-50"
                      >
                        {requesting === room.id ? "Requesting..." : "Request"}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400 mb-4">No available rooms found - contact the hostel Warden.</p>
              )}

              <div className="pt-3 border-t">
                <label className="block text-sm font-medium mb-1">Or enter a specific Room ID</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      className="input-field pl-9 w-full"
                      placeholder="Room ID (ask your Warden if unsure)"
                      value={customRoomId}
                      onChange={(e) => setCustomRoomId(e.target.value)}
                    />
                  </div>
                  <button
                    onClick={() => customRoomId.trim() && requestRoom(customRoomId.trim())}
                    disabled={!customRoomId.trim() || requesting === customRoomId.trim()}
                    className="btn-secondary text-sm disabled:opacity-50"
                  >
                    Request
                  </button>
                </div>
              </div>
            </div>
          )}

          {pendingOutgoing && (
            <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
              <Clock className="h-4 w-4 flex-shrink-0" />
              Waiting for the current roommate in {pendingOutgoing.room.floor.building.name} - Room {pendingOutgoing.room.roomNo} to
              respond to your request.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
