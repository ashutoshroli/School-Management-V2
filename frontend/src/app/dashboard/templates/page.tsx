"use client";

import { useEffect, useRef, useState } from "react";
import { FileStack, Upload, Trash2, FileDown, Loader2 } from "lucide-react";
import api from "@/lib/api";
import { resolveUploadUrl } from "@/lib/uploads";
import { formatDate } from "@/lib/utils";

type Category = "certificate" | "document";

interface TemplateSlot {
  category: Category;
  type: string;
  label: string;
}

// Every DOCX "slot" the app can hold a template for. Matches
// CertificateType / DocTemplateType in db/prisma/schema.prisma - ID_CARD
// and CUSTOM certificate types don't have a real PDF generator wired up
// yet (see certificateGenerator.service.ts), but the template file
// itself can still be uploaded/stored here ahead of that work.
const TEMPLATE_SLOTS: TemplateSlot[] = [
  { category: "certificate", type: "TRANSFER_CERTIFICATE", label: "Transfer Certificate" },
  { category: "certificate", type: "BONAFIDE", label: "Bonafide Certificate" },
  { category: "certificate", type: "CHARACTER", label: "Character Certificate" },
  { category: "certificate", type: "ID_CARD", label: "ID Card" },
  { category: "certificate", type: "CUSTOM", label: "Custom Certificate" },
  { category: "document", type: "FEE_RECEIPT", label: "Fee Receipt" },
  { category: "document", type: "PAYSLIP", label: "Payslip" },
  { category: "document", type: "REPORT_CARD", label: "Report Card" },
  { category: "document", type: "ADMISSION_FORM", label: "Admission Form" },
  { category: "document", type: "CUSTOM", label: "Custom Document" },
];

interface TemplateRecord {
  id: string;
  name: string;
  type: string;
  templateUrl: string;
  isActive?: boolean;
  updatedAt: string;
}

export default function TemplatesPage() {
  const [certTemplates, setCertTemplates] = useState<TemplateRecord[]>([]);
  const [docTemplates, setDocTemplates] = useState<TemplateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingSlot, setUploadingSlot] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const [certRes, docRes] = await Promise.all([
        api.get("/templates", { params: { category: "certificate" } }),
        api.get("/templates", { params: { category: "document" } }),
      ]);
      setCertTemplates(certRes.data.data || []);
      setDocTemplates(docRes.data.data || []);
    } catch {
      // Leave lists empty on failure; each card simply shows "not uploaded".
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTemplates(); }, []);

  const findExisting = (slot: TemplateSlot): TemplateRecord | undefined => {
    const list = slot.category === "certificate" ? certTemplates : docTemplates;
    return list.find((t) => t.type === slot.type);
  };

  const slotKey = (slot: TemplateSlot) => `${slot.category}:${slot.type}`;

  const handleFileSelected = async (slot: TemplateSlot, file: File) => {
    if (!file.name.toLowerCase().endsWith(".docx")) {
      alert("Only .docx files are allowed");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("category", slot.category);
    formData.append("type", slot.type);
    formData.append("name", slot.label);

    setUploadingSlot(slotKey(slot));
    try {
      await api.post("/templates/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      await fetchTemplates();
    } catch (err: any) {
      alert(err.response?.data?.message || "Upload failed");
    } finally {
      setUploadingSlot(null);
      const input = fileInputs.current[slotKey(slot)];
      if (input) input.value = "";
    }
  };

  const handleDelete = async (slot: TemplateSlot, template: TemplateRecord) => {
    if (!confirm(`Remove the uploaded template for "${slot.label}"?`)) return;
    try {
      await api.delete(`/templates/${template.id}`, { params: { category: slot.category } });
      await fetchTemplates();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to delete template");
    }
  };

  const renderSlot = (slot: TemplateSlot) => {
    const existing = findExisting(slot);
    const key = slotKey(slot);
    const isUploading = uploadingSlot === key;

    return (
      <div key={key} className="bg-gray-50 border border-gray-200 rounded-lg p-4 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <FileStack className="h-8 w-8 text-primary-600 flex-shrink-0" />
          <div className="min-w-0">
            <p className="font-medium text-sm">{slot.label}</p>
            {existing ? (
              <p className="text-xs text-gray-500 mt-0.5">Uploaded {formatDate(existing.updatedAt)}</p>
            ) : (
              <p className="text-xs text-gray-400 mt-0.5">No template uploaded</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 mt-auto">
          {existing && (
            <a
              href={resolveUploadUrl(existing.templateUrl)}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary text-xs flex items-center gap-1 px-2 py-1"
              title="Download current template"
            >
              <FileDown className="h-3.5 w-3.5" /> Download
            </a>
          )}

          <button
            type="button"
            onClick={() => fileInputs.current[key]?.click()}
            disabled={isUploading}
            className="btn-primary text-xs flex items-center gap-1 px-2 py-1 disabled:opacity-60"
          >
            {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {isUploading ? "Uploading..." : existing ? "Replace" : "Upload"}
          </button>

          {existing && (
            <button
              type="button"
              onClick={() => handleDelete(slot, existing)}
              className="text-red-500 hover:text-red-700 p-1"
              title="Remove template"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}

          <input
            ref={(el) => { fileInputs.current[key] = el; }}
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileSelected(slot, file);
            }}
          />
        </div>
      </div>
    );
  };

  const certificateSlots = TEMPLATE_SLOTS.filter((s) => s.category === "certificate");
  const documentSlots = TEMPLATE_SLOTS.filter((s) => s.category === "document");

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileStack className="h-6 w-6 text-primary-600" /> Document Templates
        </h1>
      </div>

      <p className="text-sm text-gray-500 mb-6">
        Upload a .docx template for each document type below. These are the master
        templates used when generating certificates and other documents for students and staff.
      </p>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full" />
        </div>
      ) : (
        <>
          <div className="card mb-6">
            <h3 className="font-semibold mb-3">Certificate Templates</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {certificateSlots.map(renderSlot)}
            </div>
          </div>

          <div className="card">
            <h3 className="font-semibold mb-3">Document Templates</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {documentSlots.map(renderSlot)}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
