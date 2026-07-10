"use client";

import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import api from "@/lib/api";
import { formatDate } from "@/lib/utils";

interface Notification {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

const LAST_SEEN_KEY = "notifications_last_seen_at";

/**
 * Bell icon + dropdown of the current user's recent notifications.
 *
 * The backend's Notification model tracks delivery status
 * (PENDING/SENT/FAILED), not read/unread - there's no "read" column to
 * update without a schema migration (see notification.controller.ts).
 * Instead, "unread" here just means "created after the last time the
 * user opened this dropdown", tracked client-side in localStorage. This
 * is a reasonable approximation for a notification bell and avoids
 * introducing a migration for this pass.
 */
export default function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      const res = await api.get("/communication/notifications", { params: { limit: 20 } });
      const items: Notification[] = res.data.data || [];
      setNotifications(items);

      const lastSeen = localStorage.getItem(LAST_SEEN_KEY);
      const lastSeenTime = lastSeen ? new Date(lastSeen).getTime() : 0;
      setUnreadCount(items.filter((n) => new Date(n.createdAt).getTime() > lastSeenTime).length);
    } catch {
      // Silently ignore - the bell just stays empty rather than
      // breaking the whole header if this call fails.
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 60_000); // light polling, no websocket infra yet
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleToggle = () => {
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString());
        setUnreadCount(0);
      }
      return next;
    });
  };

  return (
    <div ref={containerRef} className="relative">
      <button onClick={handleToggle} className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors">
        <Bell className="h-5 w-5 text-gray-600" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-96 overflow-y-auto">
          <div className="px-4 py-3 border-b font-semibold text-sm text-gray-700">Notifications</div>
          {notifications.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-gray-400">No notifications yet</p>
          ) : (
            notifications.map((n) => (
              <div key={n.id} className="px-4 py-3 border-b last:border-b-0 hover:bg-gray-50">
                <p className="text-sm font-medium text-gray-900">{n.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">{n.body}</p>
                <p className="text-[11px] text-gray-400 mt-1">{formatDate(n.createdAt)}</p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
