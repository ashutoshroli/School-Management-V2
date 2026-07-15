"use client";

import { useState, useEffect } from "react";
import { Radio, Plus, Trash2, RefreshCw, Copy, CheckCircle2, Eye, EyeOff, Power } from "lucide-react";
import api from "@/lib/api";
import Modal from "@/components/ui/Modal";
import { formatDate } from "@/lib/utils";
import { usePermissions } from "@/hooks/usePermissions";

interface Device {
  id: string;
  deviceId: string;
  name: string;
  location: string | null;
  isActive: boolean;
  createdAt: string;
}

/**
 * Attendance device (RFID/card-tap reader) admin management.
 *
 * The backend only ever returns a device's apiKey ONCE - at create
 * time, or right after a regenerate-key call (see
 * attendanceDevice.controller.ts's doc comments) - never on a
 * subsequent read. So this page always shows a "copy this now, it
 * won't be shown again" banner immediately after either action, and
 * the devices LIST never has an apiKey column at all (nothing to show).
 */
export default function AttendanceDevicesPage() {
  const { canDelete } = usePermissions();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);

  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState({ name: "", location: "" });
  const [submitting, setSubmitting] = useState(false);

  // One-time reveal of a freshly-issued apiKey (from create or
  // regenerate) - cleared as soon as the modal closes, never re-fetchable.
  const [revealedKey, setRevealedKey] = useState<{ deviceName: string; apiKey: string } | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);

  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchDevices = async () => {
    setLoading(true);
    try {
      const res = await api.get("/facilities/attendance-devices");
      setDevices(res.data.data || []);
    } catch {
      setDevices([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { fetchDevices(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await api.post("/facilities/attendance-devices", form);
      const created = res.data.data;
      setShowAddModal(false);
      setForm({ name: "", location: "" });
      setRevealedKey({ deviceName: created.name, apiKey: created.apiKey });
      setShowKey(false);
      setCopied(false);
      fetchDevices();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to register device");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegenerate = async (device: Device) => {
    if (!confirm(`Regenerate the API key for "${device.name}"? The physical reader will need to be reconfigured with the new key immediately - the old key stops working right away.`)) return;
    setRegeneratingId(device.id);
    try {
      const res = await api.post(`/facilities/attendance-devices/${device.id}/regenerate-key`);
      setRevealedKey({ deviceName: device.name, apiKey: res.data.data.apiKey });
      setShowKey(false);
      setCopied(false);
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to regenerate API key");
    } finally {
      setRegeneratingId(null);
    }
  };

  const handleToggleActive = async (device: Device) => {
    setTogglingId(device.id);
    try {
      await api.patch(`/facilities/attendance-devices/${device.id}`, { isActive: !device.isActive });
      fetchDevices();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to update device");
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (device: Device) => {
    if (!confirm(`Delete device "${device.name}"? Any physical reader still configured with its key will stop working immediately.`)) return;
    setDeletingId(device.id);
    try {
      await api.delete(`/facilities/attendance-devices/${device.id}`);
      fetchDevices();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to delete device");
    } finally {
      setDeletingId(null);
    }
  };

  const copyKey = () => {
    if (!revealedKey) return;
    navigator.clipboard.writeText(revealedKey.apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Radio className="h-6 w-6 text-primary-600" /> Attendance Devices
          </h1>
          <p className="text-gray-500 mt-1">
            Manage RFID/card-tap readers used for student and staff attendance.
          </p>
        </div>
        <button onClick={() => setShowAddModal(true)} className="btn-primary flex items-center gap-2">
          <Plus className="h-4 w-4" /> Register Device
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
        </div>
      ) : devices.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-500">No attendance devices registered yet.</p>
          <p className="text-sm text-gray-400 mt-1">Register a device to get an API key for a physical RFID reader.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Location</th>
                <th className="px-4 py-3 text-left">Device ID</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Registered</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id} className="border-b">
                  <td className="px-4 py-3 font-medium">{d.name}</td>
                  <td className="px-4 py-3 text-gray-500">{d.location || "-"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">{d.deviceId}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${d.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                      {d.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(d.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end items-center gap-1">
                      <button
                        onClick={() => handleToggleActive(d)}
                        disabled={togglingId === d.id}
                        title={d.isActive ? "Deactivate" : "Activate"}
                        className={`p-1.5 rounded hover:bg-gray-100 disabled:opacity-40 ${d.isActive ? "text-green-600" : "text-gray-400"}`}
                      >
                        <Power className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleRegenerate(d)}
                        disabled={regeneratingId === d.id}
                        title="Regenerate API Key"
                        className="p-1.5 text-amber-600 hover:bg-amber-50 rounded disabled:opacity-40"
                      >
                        <RefreshCw className={`h-4 w-4 ${regeneratingId === d.id ? "animate-spin" : ""}`} />
                      </button>
                      {canDelete && (
                        <button
                          onClick={() => handleDelete(d)}
                          disabled={deletingId === d.id}
                          title="Delete"
                          className="p-1.5 text-red-500 hover:bg-red-50 rounded disabled:opacity-40"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Register Device */}
      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="Register Attendance Device">
        <form onSubmit={handleAdd} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Device Name *</label>
            <input
              className="input-field"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Main Gate Reader"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Location</label>
            <input
              className="input-field"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              placeholder="e.g. Block A Entry"
            />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setShowAddModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={submitting} className="btn-primary disabled:opacity-50">
              {submitting ? "Registering..." : "Register"}
            </button>
          </div>
        </form>
      </Modal>

      {/* One-time API key reveal (create or regenerate) */}
      <Modal isOpen={!!revealedKey} onClose={() => setRevealedKey(null)} title={`API Key - ${revealedKey?.deviceName || ""}`}>
        <div className="space-y-4">
          <div className="flex items-start gap-2 px-4 py-3 rounded-lg text-sm bg-amber-50 text-amber-800 border border-amber-200">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <p>
              Copy this API key now and configure it on the physical reader. For security, it will <strong>not</strong> be
              shown again - if lost, you'll need to regenerate a new one (which invalidates this one).
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex-1 font-mono text-xs bg-gray-100 border rounded-lg px-3 py-2 overflow-x-auto whitespace-nowrap">
              {showKey ? revealedKey?.apiKey : "•".repeat(48)}
            </div>
            <button type="button" onClick={() => setShowKey((v) => !v)} title={showKey ? "Hide" : "Show"} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg">
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
            <button type="button" onClick={copyKey} title="Copy" className="p-2 text-primary-600 hover:bg-primary-50 rounded-lg">
              {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>

          <div className="flex justify-end pt-4 border-t">
            <button type="button" onClick={() => setRevealedKey(null)} className="btn-primary">Done</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
