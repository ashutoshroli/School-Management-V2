"use client";

import { useState } from "react";
import { Send, AlertCircle, CheckCircle2 } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";


export default function FeeRemindersPage() {
  const { user } = useAuth();
  const [channel, setChannel] = useState<"SMS" | "WHATSAPP" | "EMAIL">("SMS");
  const [status, setStatus] = useState<"OVERDUE" | "PENDING">("OVERDUE");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleSend = async () => {
    if (!confirm(`Send fee reminders via ${channel} to all ${status} students? This will send actual notifications.`)) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await api.post("/fees/reminders/send", {
        branchId: user?.branchId,
        channel,
        status,
      });
      const data = res.data.data;
      setResult({
        type: "success",
        text: `Reminders sent successfully! ${data?.sent || 0} students notified.`,
      });
    } catch (err: any) {
      setResult({
        type: "error",
        text: err.response?.data?.message || "Failed to send fee reminders.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Send className="h-6 w-6 text-primary-600" /> Fee Reminders
        </h1>
        <p className="text-gray-500 mt-1">
          Send payment reminders to parents/students with pending or overdue fees
        </p>
      </div>

      {result && (
        <div className={`mb-4 p-3 rounded-lg text-sm border flex items-center gap-2 ${
          result.type === "success" ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"
        }`}>
          {result.type === "success" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {result.text}
        </div>
      )}

      <div className="card max-w-lg">
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium mb-2">Target Students</label>
            <select className="input-field" value={status} onChange={(e) => setStatus(e.target.value as any)}>
              <option value="OVERDUE">Overdue Fees Only</option>
              <option value="PENDING">All Pending (including not yet due)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Notification Channel</label>
            <div className="flex gap-3">
              {(["SMS", "WHATSAPP", "EMAIL"] as const).map((ch) => (
                <button
                  key={ch}
                  onClick={() => setChannel(ch)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border ${
                    channel === ch ? "bg-primary-600 text-white border-primary-600" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {ch}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <p>This will send real notifications to all eligible parents/students. Make sure the {channel} integration is configured.</p>
          </div>

          <button
            onClick={handleSend}
            disabled={loading}
            className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Send className="h-4 w-4" /> {loading ? "Sending Reminders..." : "Send Reminders"}
          </button>
        </div>
      </div>
    </div>
  );
}
