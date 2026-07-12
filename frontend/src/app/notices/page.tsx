"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bell, Pin, Paperclip } from "lucide-react";
import api from "@/lib/api";
import { formatDate } from "@/lib/utils";

/**
 * Public, unauthenticated notice board - only notices an admin
 * explicitly opted into public visibility (see Notice.isPublic's doc
 * comment in schema.prisma / togglePublicVisibility in
 * notice.controller.ts) show up here.
 */
export default function PublicNoticesPage() {
  const [notices, setNotices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get("/public/notices")
      .then((res) => setNotices(res.data.data || []))
      .catch(() => setNotices([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="max-w-2xl mx-auto">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6">
          <ArrowLeft className="h-4 w-4" /> Back to Home
        </Link>

        <div className="flex items-center gap-2 mb-6">
          <Bell className="h-7 w-7 text-primary-600" />
          <h1 className="text-xl font-bold text-gray-900">Notices</h1>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
          </div>
        ) : notices.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-12">No public notices at the moment.</p>
        ) : (
          <div className="space-y-3">
            {notices.map((n) => (
              <div key={n.id} className="card">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold text-gray-900 flex items-center gap-1.5">
                    {n.isPinned && <Pin className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />}
                    {n.title}
                  </h3>
                  <span className="text-xs text-gray-400 flex-shrink-0">{formatDate(n.createdAt)}</span>
                </div>
                <p className="text-sm text-gray-600 mt-2 whitespace-pre-line">{n.body}</p>
                <div className="flex items-center justify-between mt-3 text-xs text-gray-400">
                  <span>{n.branch?.name}</span>
                  {n.attachmentUrl && (
                    <a href={n.attachmentUrl} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline flex items-center gap-1">
                      <Paperclip className="h-3.5 w-3.5" /> Attachment
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
