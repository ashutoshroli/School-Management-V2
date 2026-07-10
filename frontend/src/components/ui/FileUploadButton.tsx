"use client";

import { useRef, useState } from "react";
import { Upload, Loader2 } from "lucide-react";
import api from "@/lib/api";

interface FileUploadButtonProps {
  /** API path to POST the multipart form to, e.g. `/students/abc123/documents` */
  uploadPath: string;
  /** Extra form fields to send alongside the file, e.g. `{ type: "photo" }` */
  extraFields?: Record<string, string>;
  accept?: string;
  label?: string;
  onUploaded?: (data: any) => void;
  className?: string;
}

/**
 * Generic multipart file-upload button. Used for student/staff document
 * uploads and (via a thin wrapper) avatar uploads - kept generic since
 * the backend upload endpoints all share the same "multipart field
 * named 'file'" contract (see backend/src/middleware/upload.ts).
 */
export default function FileUploadButton({
  uploadPath,
  extraFields,
  accept = "image/jpeg,image/png,image/webp,application/pdf",
  label = "Upload",
  onUploaded,
  className = "",
}: FileUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);
    if (extraFields) {
      Object.entries(extraFields).forEach(([key, value]) => formData.append(key, value));
    }

    setUploading(true);
    try {
      const res = await api.post(uploadPath, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      onUploaded?.(res.data.data);
    } catch (err: any) {
      alert(err.response?.data?.message || "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      disabled={uploading}
      className={`btn-secondary flex items-center gap-2 text-sm disabled:opacity-60 ${className}`}
    >
      {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
      {uploading ? "Uploading..." : label}
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={handleFileChange} />
    </button>
  );
}
