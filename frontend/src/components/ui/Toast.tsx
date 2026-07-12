"use client";

import { useEffect, useState, useCallback } from "react";
import { create } from "zustand";
import { CheckCircle, XCircle, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastType = "success" | "error" | "warning" | "info";

interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastStore {
  toasts: ToastItem[];
  addToast: (toast: Omit<ToastItem, "id">) => void;
  removeToast: (id: string) => void;
}

export const useToast = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (toast) => {
    const id = Math.random().toString(36).slice(2);
    set((state) => ({
      toasts: [...state.toasts, { ...toast, id }],
    }));
  },
  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },
}));

// Convenience helpers
export const toast = {
  success: (title: string, message?: string) =>
    useToast.getState().addToast({ type: "success", title, message }),
  error: (title: string, message?: string) =>
    useToast.getState().addToast({ type: "error", title, message }),
  warning: (title: string, message?: string) =>
    useToast.getState().addToast({ type: "warning", title, message }),
  info: (title: string, message?: string) =>
    useToast.getState().addToast({ type: "info", title, message }),
};

const ICONS = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const COLORS = {
  success: "bg-green-50 border-green-200 text-green-800",
  error: "bg-red-50 border-red-200 text-red-800",
  warning: "bg-amber-50 border-amber-200 text-amber-800",
  info: "bg-blue-50 border-blue-200 text-blue-800",
};

const ICON_COLORS = {
  success: "text-green-500",
  error: "text-red-500",
  warning: "text-amber-500",
  info: "text-blue-500",
};

function ToastItem({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const [exiting, setExiting] = useState(false);
  const Icon = ICONS[item.type];

  const handleClose = useCallback(() => {
    setExiting(true);
    setTimeout(onClose, 200);
  }, [onClose]);

  useEffect(() => {
    const duration = item.duration || 4000;
    const timer = setTimeout(handleClose, duration);
    return () => clearTimeout(timer);
  }, [handleClose, item.duration]);

  return (
    <div
      className={cn(
        "flex items-start gap-3 p-4 rounded-lg border shadow-lg max-w-sm w-full transition-all duration-200",
        COLORS[item.type],
        exiting ? "opacity-0 translate-x-4" : "opacity-100 translate-x-0"
      )}
    >
      <Icon className={cn("h-5 w-5 flex-shrink-0 mt-0.5", ICON_COLORS[item.type])} />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm">{item.title}</p>
        {item.message && <p className="text-xs mt-0.5 opacity-80">{item.message}</p>}
      </div>
      <button onClick={handleClose} className="flex-shrink-0 opacity-60 hover:opacity-100">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const { toasts, removeToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2">
      {toasts.map((item) => (
        <ToastItem key={item.id} item={item} onClose={() => removeToast(item.id)} />
      ))}
    </div>
  );
}
