"use client";

import { useState, useEffect } from "react";
import { Bell, CheckCircle2, AlertCircle, IndianRupee, ClipboardCheck, FileText, BookOpen, Info } from "lucide-react";
import api from "@/lib/api";
import { formatDate } from "@/lib/utils";

interface Notification {
  id: string;
  title: string;
  body: string;
  type: string;
  channel: string;
  status: string;
  sentAt: string | null;
  createdAt: string;
}

const typeIcons: Record<string, any> = {
  FEE_DUE: IndianRupee,
  FEE_PAID: CheckCircle2,
  ATTENDANCE_IN: ClipboardCheck,
  ATTENDANCE_OUT: ClipboardCheck,
  EXAM_RESULT: FileText,
  LEAVE_STATUS: AlertCircle,
  NOTICE: Bell,
  HOMEWORK: BookOpen,
  GENERAL: Info,
};

const typeColors: Record<string, string> = {
  FEE_DUE: "text-red-600 bg-red-50",
  FEE_PAID: "text-green-600 bg-green-50",
  ATTENDANCE_IN: "text-blue-600 bg-blue-50",
  ATTENDANCE_OUT: "text-orange-600 bg-orange-50",
  EXAM_RESULT: "text-purple-600 bg-purple-50",
  LEAVE_STATUS: "text-yellow-600 bg-yellow-50",
  NOTICE: "text-primary-600 bg-primary-50",
  HOMEWORK: "text-teal-600 bg-teal-50",
  GENERAL: "text-gray-600 bg-gray-50",
};

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchNotifications = async () => {
      setLoading(true);
      try {
        const res = await api.get("/communication/notifications");
        setNotifications(res.data.data || []);
      } catch {
        setNotifications([]);
      } finally {
        setLoading(false);
      }
    };
    fetchNotifications();
  }, []);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Bell className="h-6 w-6 text-primary-600" /> Notifications
        </h1>
        <p className="text-gray-500 mt-1">Your recent notifications and alerts</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
        </div>
      ) : notifications.length === 0 ? (
        <div className="card text-center py-12">
          <Bell className="h-12 w-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No notifications yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.map((n) => {
            const Icon = typeIcons[n.type] || Info;
            const colorClass = typeColors[n.type] || typeColors.GENERAL;
            return (
              <div key={n.id} className="card flex items-start gap-4">
                <div className={`p-2 rounded-lg ${colorClass}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-gray-900">{n.title}</h3>
                  <p className="text-sm text-gray-600 mt-0.5">{n.body}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-xs text-gray-400">{formatDate(n.createdAt)}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      n.status === "SENT" ? "bg-green-100 text-green-700" :
                      n.status === "FAILED" ? "bg-red-100 text-red-700" :
                      "bg-yellow-100 text-yellow-700"
                    }`}>
                      {n.status}
                    </span>
                    <span className="text-xs text-gray-400">{n.channel}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
