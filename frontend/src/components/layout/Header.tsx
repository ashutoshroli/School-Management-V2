"use client";

import { useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import api from "@/lib/api";
import { resolveUploadUrl } from "@/lib/uploads";
import NotificationBell from "./NotificationBell";
import { LogOut, User, Loader2 } from "lucide-react";

export default function Header() {
  const { user, logout, setAuth, token } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user || !token) return;

    const formData = new FormData();
    formData.append("file", file);

    setUploadingAvatar(true);
    try {
      const res = await api.post("/auth/avatar", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setAuth({ ...user, avatar: res.data.data.avatar }, token);
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to update avatar");
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 sticky top-0 z-40">
      {/* Left - Page Title area */}
      <div>
        <h2 className="text-lg font-semibold text-gray-800">
          Welcome back, {user?.name?.split(" ")[0] || "User"}
        </h2>
      </div>

      {/* Right - Actions */}
      <div className="flex items-center gap-4">
        {/* Notifications */}
        <NotificationBell />

        {/* Profile dropdown */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingAvatar}
            title="Click to change your profile photo"
            className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center overflow-hidden hover:ring-2 hover:ring-primary-300 transition-all disabled:opacity-60"
          >
            {uploadingAvatar ? (
              <Loader2 className="h-4 w-4 text-primary-600 animate-spin" />
            ) : user?.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={resolveUploadUrl(user.avatar)} alt={user.name} className="w-full h-full object-cover" />
            ) : (
              <User className="h-4 w-4 text-primary-600" />
            )}
          </button>
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleAvatarChange} />
          <button
            onClick={logout}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            title="Logout"
          >
            <LogOut className="h-5 w-5 text-gray-600" />
          </button>
        </div>
      </div>
    </header>
  );
}
