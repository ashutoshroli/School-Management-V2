"use client";

import { useEffect, useRef, useState } from "react";
import { FileStack, Upload, Trash2, FileDown, Loader2, Info, Copy, Check, CalendarClock } from "lucide-react";
import api from "@/lib/api";
import { resolveUploadUrl } from "@/lib/uploads";
import { formatDate } from "@/lib/utils";
import Modal from "@/components/ui/Modal";
import { usePermissions } from "@/hooks/usePermissions";

type Category = "certificate" | "document";

interface TemplateSlot {
  category: Category;
  type: string;
  label: string;
  /** Short note on where/how this template type is used. */
  description: string;
  /**
   * Placeholder fields available for this template type, based on the
   * actual data the app has on hand for it (see
   * CertificateStudentInfo/CertificateRenderParams in
   * certificateGenerator.service.ts for the certificate fields, and the
   * relevant Prisma models in db/prisma/schema.prisma for the rest).
   * In the .docx file, write these wrapped in double curly braces,
   * e.g. {{studentName}}, exactly as the "key" below (case-sensitive).
   */
  placeholders: { key: string; description: string }[];
  /**
   * Optional note about docxtemplater's loop syntax
   * ({{#arrayKey}}...{{/arrayKey}}) for templates that support a
   * repeating table row (currently REPORT_CARD's per-subject marks
   * table and ADMIT_CARD's per-subject schedule table) - shown as a
   * separate callout in the guide modal
   * rather than in the placeholders list, since it isn't a single
   * {{tag}} that the "copy" button could meaningfully copy.
   */
  loopSyntaxNote?: string;
  /**
   * Filename of a ready-made example .docx served from
   * frontend/public/sample-templates/ (generated once, checked into
   * the repo - see that directory's contents). Lets an admin download
   * a working example with all the right {{placeholders}} already
   * filled in as a starting point, instead of building a template from
   * scratch using only the guide's field list.
   */
  sampleFile: string;
  /**
   * True for document types that can ALSO have a separate template
   * PER EXAM (REPORT_CARD, ADMIT_CARD - see DocumentTemplate.examId in
   * schema.prisma), in addition to the one school-wide default slot
   * every type has. These slots render an extra "Manage exam-specific
   * templates" button that opens a dedicated picker: choose an exam
   * first, then upload a template just for that exam - and any number
   * of exams can each have their own uploaded template at once, listed
   * together in that same picker.
   */
  examScoped?: boolean;
}

interface ExamOption {
  id: string;
  name: string;
  class?: { name?: string } | null;
  academicYear?: { name?: string } | null;
}

// Every DOCX "slot" the app can hold a template for. Matches
// CertificateType / DocTemplateType in db/prisma/schema.prisma - ID_CARD
// and CUSTOM certificate types don't have a real PDF generator wired up
// yet (see certificateGenerator.service.ts), but the template file
// itself can still be uploaded/stored here ahead of that work.
const STUDENT_CORE_PLACEHOLDERS = [
  { key: "studentName", description: "Student's full name" },
  { key: "admissionNo", description: "Admission number" },
  { key: "fatherName", description: "Father's name" },
  { key: "motherName", description: "Mother's name" },
  { key: "dateOfBirth", description: "Date of birth (DD-MM-YYYY)" },
  { key: "className", description: "Class name, e.g. Class 5" },
  { key: "sectionName", description: "Section name, e.g. A" },
];

const BRANCH_PLACEHOLDERS = [
  { key: "branchName", description: "School/branch name" },
  { key: "branchAddress", description: "Branch address (line + city, state, pincode)" },
  { key: "branchPhone", description: "Branch contact phone number" },
];

const CERT_META_PLACEHOLDERS = [
  { key: "serialNo", description: "Unique certificate serial number" },
  { key: "issueDate", description: "Date the certificate was issued" },
  { key: "verifyUrl", description: "Public link to verify this certificate's authenticity" },
];

const TEMPLATE_SLOTS: TemplateSlot[] = [
  {
    category: "certificate",
    type: "TRANSFER_CERTIFICATE",
    label: "Transfer Certificate",
    description: "Issued when a student leaves the school (e.g. for transfer to another school).",
    sampleFile: "TRANSFER_CERTIFICATE.docx",
    placeholders: [
      ...STUDENT_CORE_PLACEHOLDERS,
      { key: "nationality", description: "Nationality, e.g. Indian" },
      { key: "category", description: "Category, e.g. General/OBC/SC/ST" },
      { key: "admissionDate", description: "Date the student was admitted" },
      { key: "leavingDate", description: "Date the student left the school" },
      { key: "leavingReason", description: "Reason for leaving" },
      ...BRANCH_PLACEHOLDERS,
      ...CERT_META_PLACEHOLDERS,
    ],
  },
  {
    category: "certificate",
    type: "BONAFIDE",
    label: "Bonafide Certificate",
    description: "Confirms a student is currently enrolled - commonly needed for passport/visa or official use.",
    sampleFile: "BONAFIDE.docx",
    placeholders: [
      ...STUDENT_CORE_PLACEHOLDERS,
      { key: "purpose", description: "Purpose stated by the parent, e.g. \"applying for a passport\"" },
      ...BRANCH_PLACEHOLDERS,
      ...CERT_META_PLACEHOLDERS,
    ],
  },
  {
    category: "certificate",
    type: "CHARACTER",
    label: "Character Certificate",
    description: "Confirms a student's conduct/character during their time at the school.",
    sampleFile: "CHARACTER.docx",
    placeholders: [
      ...STUDENT_CORE_PLACEHOLDERS,
      ...BRANCH_PLACEHOLDERS,
      ...CERT_META_PLACEHOLDERS,
    ],
  },
  {
    category: "certificate",
    type: "ID_CARD",
    label: "ID Card",
    description: "Student identity card layout. If you upload a .docx template here, it's used first (filled in with these placeholders); otherwise a built-in structured layout is used as a fallback.",
    sampleFile: "ID_CARD.docx",
    placeholders: [
      ...STUDENT_CORE_PLACEHOLDERS,
      { key: "photoUrl", description: "Student's photo" },
      { key: "bloodGroup", description: "Blood group" },
      { key: "cardId", description: "RFID card ID (if assigned)" },
      { key: "address", description: "Residential address" },
      ...BRANCH_PLACEHOLDERS,
    ],
  },
  {
    category: "certificate",
    type: "CUSTOM",
    label: "Custom Certificate",
    description: "Any other certificate type not covered above - use whichever placeholders you need from this list.",
    sampleFile: "CUSTOM_CERT.docx",
    placeholders: [
      ...STUDENT_CORE_PLACEHOLDERS,
      { key: "nationality", description: "Nationality" },
      { key: "category", description: "Category, e.g. General/OBC/SC/ST" },
      { key: "admissionDate", description: "Date the student was admitted" },
      ...BRANCH_PLACEHOLDERS,
      ...CERT_META_PLACEHOLDERS,
    ],
  },
  {
    category: "document",
    type: "FEE_RECEIPT",
    label: "Fee Receipt",
    description: "Given to a parent as proof of a fee payment.",
    sampleFile: "FEE_RECEIPT.docx",
    placeholders: [
      { key: "receiptNo", description: "Unique receipt number" },
      { key: "studentName", description: "Student's full name" },
      { key: "admissionNo", description: "Admission number" },
      { key: "className", description: "Class name" },
      { key: "sectionName", description: "Section name" },
      { key: "feeCategoryName", description: "Fee category, e.g. Tuition, Transport" },
      { key: "amount", description: "Amount paid" },
      { key: "lateFeeCharged", description: "Late fee charged, if any" },
      { key: "paymentMode", description: "Payment mode, e.g. CASH, ONLINE, UPI" },
      { key: "transactionId", description: "Online payment transaction reference" },
      { key: "paidAt", description: "Date/time payment was made" },
      ...BRANCH_PLACEHOLDERS,
    ],
  },
  {
    category: "document",
    type: "PAYSLIP",
    label: "Payslip",
    description: "Monthly salary slip generated for a staff member.",
    sampleFile: "PAYSLIP.docx",
    placeholders: [
      { key: "staffName", description: "Staff member's full name" },
      { key: "employeeId", description: "Employee ID" },
      { key: "designation", description: "Designation, e.g. Teacher, Accountant" },
      { key: "department", description: "Department" },
      { key: "month", description: "Payslip month" },
      { key: "year", description: "Payslip year" },
      { key: "workingDays", description: "Total working days in the month" },
      { key: "presentDays", description: "Days present" },
      { key: "basic", description: "Basic salary" },
      { key: "hra", description: "House Rent Allowance" },
      { key: "da", description: "Dearness Allowance" },
      { key: "grossEarning", description: "Total gross earning" },
      { key: "pfAmount", description: "Provident Fund deduction" },
      { key: "esiAmount", description: "ESI deduction" },
      { key: "tdsAmount", description: "TDS deduction" },
      { key: "totalDeduction", description: "Total deductions" },
      { key: "netPay", description: "Final net pay" },
      ...BRANCH_PLACEHOLDERS,
    ],
  },
  {
    category: "document",
    type: "REPORT_CARD",
    label: "Report Card",
    description: "Exam result summary for a student. This is the school-wide default used for every exam that doesn't have its own template - click \"Exam-specific templates\" below to upload a DIFFERENT layout for one or more individual exams instead.",
    sampleFile: "REPORT_CARD.docx",
    examScoped: true,
    loopSyntaxNote:
      "The {{subjectName}}/{{maxMarks}}/{{obtainedMarks}}/{{grade}} placeholders below only fill in with the FIRST " +
      "subject's marks - fine for a simple one-line summary, but not enough for a real multi-subject table. To show " +
      "every subject as its own table row instead, build a one-row table in Word, then wrap that row in a loop: put " +
      "{{#marks}} at the very start of the row's first cell and {{/marks}} at the very end of the row's last cell " +
      "(double curly braces, same as every other placeholder here), then inside that row use {{subjectName}}, " +
      "{{maxMarks}}, {{obtainedMarks}}, {{grade}} in the individual cells. Everything between {{#marks}} and " +
      "{{/marks}} repeats once per subject automatically. The downloadable sample below already has this set up correctly.",
    placeholders: [
      { key: "studentName", description: "Student's full name" },
      { key: "admissionNo", description: "Admission number" },
      { key: "className", description: "Class name" },
      { key: "sectionName", description: "Section name" },
      { key: "examName", description: "Exam name, e.g. Half Yearly, Annual" },
      { key: "subjectName", description: "Simple template only: first subject's name" },
      { key: "maxMarks", description: "Simple template only: first subject's maximum marks" },
      { key: "obtainedMarks", description: "Simple template only: first subject's marks obtained" },
      { key: "grade", description: "Simple template only: first subject's grade" },
      { key: "totalMarks", description: "Total marks across all subjects" },
      { key: "percentage", description: "Overall percentage" },
      ...BRANCH_PLACEHOLDERS,
    ],
  },
  {
    category: "document",
    type: "ADMIT_CARD",
    label: "Admit Card",
    description: "Exam admit card / hall ticket, listing every subject a student is permitted to sit for (with date/time/room) - separate from the Report Card template above, which is for RESULTS, not exam entry permission. This is the school-wide default used for every exam that doesn't have its own template - click \"Exam-specific templates\" below to upload a DIFFERENT layout for one or more individual exams instead (e.g. a distinct Annual Exam hall ticket).",
    sampleFile: "ADMIT_CARD.docx",
    examScoped: true,
    loopSyntaxNote:
      "The {{subjects}} data is a per-subject list (date/time/room) - build a one-row table in Word, wrap that row in " +
      "{{#subjects}}...{{/subjects}} (double curly braces, same as every other placeholder here), and inside the row " +
      "use {{subjectName}}, {{examDate}}, {{startTime}}, {{endTime}}, {{roomNo}}. Everything between the tags " +
      "repeats once per subject the student is permitted to sit for.",
    placeholders: [
      { key: "studentName", description: "Student's full name" },
      { key: "admissionNo", description: "Admission number" },
      { key: "className", description: "Class name" },
      { key: "sectionName", description: "Section name" },
      { key: "examName", description: "Exam name, e.g. Half Yearly, Annual" },
      { key: "serialNo", description: "Unique admit card serial number" },
      { key: "status", description: "ELIGIBLE, PROVISIONAL, or DENIED" },
      { key: "remarks", description: "Reason, if PROVISIONAL/DENIED (e.g. an eligibility rule that failed)" },
      ...BRANCH_PLACEHOLDERS,
    ],
  },
  {
    category: "document",
    type: "ADMISSION_FORM",
    label: "Admission Form",
    description: "Printable form summarizing a new admission inquiry/application.",
    sampleFile: "ADMISSION_FORM.docx",
    placeholders: [
      { key: "studentName", description: "Applicant's full name" },
      { key: "dateOfBirth", description: "Date of birth" },
      { key: "gender", description: "Gender" },
      { key: "classAppliedFor", description: "Class applied for" },
      { key: "parentName", description: "Parent/guardian name" },
      { key: "parentEmail", description: "Parent/guardian email" },
      { key: "parentPhone", description: "Parent/guardian phone" },
      { key: "address", description: "Residential address" },
      { key: "previousSchool", description: "Previous school attended, if any" },
      ...BRANCH_PLACEHOLDERS,
    ],
  },
  {
    category: "document",
    type: "CUSTOM",
    label: "Custom Document",
    description: "Any other document type not covered above - use whichever placeholders you need from this list.",
    sampleFile: "CUSTOM_DOC.docx",
    placeholders: [
      ...STUDENT_CORE_PLACEHOLDERS,
      ...BRANCH_PLACEHOLDERS,
      { key: "date", description: "Current date" },
    ],
  },
];

interface TemplateRecord {
  id: string;
  name: string;
  type: string;
  templateUrl: string;
  /** Certificate templates: whether this is the ONE active template used for generation. */
  isActive?: boolean;
  /** Document templates: whether this is the ONE default template used for generation. */
  isDefault?: boolean;
  updatedAt: string;
  /** Document templates only - set when this row is scoped to one specific exam (see schema.prisma). */
  examId?: string | null;
}

export default function TemplatesPage() {
  const { canDelete } = usePermissions();
  const [certTemplates, setCertTemplates] = useState<TemplateRecord[]>([]);
  const [docTemplates, setDocTemplates] = useState<TemplateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingSlot, setUploadingSlot] = useState<string | null>(null);
  const [guideSlot, setGuideSlot] = useState<TemplateSlot | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  // Exam-specific templates (REPORT_CARD / ADMIT_CARD only - see
  // TemplateSlot.examScoped). Every exam is uploaded/replaced/deleted
  // independently, so instead of one TemplateRecord per slot this is
  // the full list for the currently-open picker's type, keyed by examId.
  const [examScopedSlot, setExamScopedSlot] = useState<TemplateSlot | null>(null);
  const [exams, setExams] = useState<ExamOption[]>([]);
  const [loadingExams, setLoadingExams] = useState(false);
  const [examTemplates, setExamTemplates] = useState<TemplateRecord[]>([]);
  const [selectedExamId, setSelectedExamId] = useState("");
  const [uploadingExamId, setUploadingExamId] = useState<string | null>(null);
  const examFileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const copyPlaceholder = async (key: string) => {
    const text = `{{${key}}}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) - the text is
      // still visible in the modal for the admin to copy manually.
    }
  };

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

  // Point 5 (Multiple Template Upload): a slot can now have SEVERAL
  // uploaded templates - findSlotTemplates returns ALL of them (for
  // the picker list), findActiveTemplate returns just the one
  // currently used for generation (isActive/isDefault).
  const findSlotTemplates = (slot: TemplateSlot): TemplateRecord[] => {
    const list = slot.category === "certificate" ? certTemplates : docTemplates;
    // Document templates only ever match the SCHOOL-WIDE slot here
    // (examId: null) - exam-specific rows are managed entirely by the
    // separate exam-scoped picker below.
    return list.filter((t) => t.type === slot.type && (slot.category === "certificate" || !t.examId));
  };
  const findActiveTemplate = (slot: TemplateSlot): TemplateRecord | undefined => {
    const list = findSlotTemplates(slot);
    return list.find((t) => (slot.category === "certificate" ? t.isActive : t.isDefault));
  };

  const slotKey = (slot: TemplateSlot) => `${slot.category}:${slot.type}`;

  // Which slot's "all uploaded templates" picker is currently open -
  // separate from the placeholder Guide modal (guideSlot) and the
  // exam-scoped picker (examScopedSlot) below.
  const [manageSlot, setManageSlot] = useState<TemplateSlot | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);

  const handleFileSelected = async (slot: TemplateSlot, file: File) => {
    if (!file.name.toLowerCase().endsWith(".docx")) {
      alert("Only .docx files are allowed");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("category", slot.category);
    formData.append("type", slot.type);
    formData.append("name", file.name.replace(/\.docx$/i, "") || slot.label);

    setUploadingSlot(slotKey(slot));
    try {
      // BUG FIX: see exams/question-papers/page.tsx's handleUpload for
      // the full explanation - a boundary-less manually-set multipart
      // Content-Type header can leave the upload request stuck
      // forever instead of resolving/rejecting.
      await api.post("/templates/upload", formData, {
        headers: { "Content-Type": undefined },
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
    if (!confirm(`Remove the template "${template.name}"?`)) return;
    try {
      await api.delete(`/templates/${template.id}`, { params: { category: slot.category } });
      await fetchTemplates();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to delete template");
    }
  };

  // Point 5: select which of several uploaded templates for this slot
  // is the one actually used for generation.
  const handleSetActive = async (slot: TemplateSlot, template: TemplateRecord) => {
    setActivatingId(template.id);
    try {
      await api.patch(`/templates/${template.id}/activate`, null, { params: { category: slot.category } });
      await fetchTemplates();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to set active template");
    } finally {
      setActivatingId(null);
    }
  };

  // ---- Exam-specific templates picker (REPORT_CARD / ADMIT_CARD) ----
  // Opening the picker loads BOTH the exam list (so the admin can pick
  // "which exam") and every already-uploaded template for this slot's
  // type across ALL exams (so more than one exam's template shows up
  // together here, not just whichever one exam was picked last).
  const openExamScopedPicker = async (slot: TemplateSlot) => {
    setExamScopedSlot(slot);
    setSelectedExamId("");
    setLoadingExams(true);
    try {
      const [examsRes, templatesRes] = await Promise.all([
        api.get("/academics/exams"),
        api.get("/templates", { params: { category: "document" } }),
      ]);
      setExams(examsRes.data.data || []);
      // Only THIS slot's type, and only rows that actually belong to
      // an exam (examId set) - the school-wide default row (examId:
      // null) for the same type is managed by the main card above,
      // not this picker.
      const allDocTemplates: TemplateRecord[] = templatesRes.data.data || [];
      setExamTemplates(allDocTemplates.filter((t) => t.type === slot.type && t.examId));
    } catch {
      setExams([]);
      setExamTemplates([]);
    } finally {
      setLoadingExams(false);
    }
  };

  const closeExamScopedPicker = () => {
    setExamScopedSlot(null);
    setExams([]);
    setExamTemplates([]);
    setSelectedExamId("");
  };

  // Point 5: an exam can now have several uploaded templates too -
  // findExamTemplates returns ALL of them for a given exam.
  const findExamTemplates = (examId: string): TemplateRecord[] => examTemplates.filter((t) => t.examId === examId);

  const examLabel = (exam: ExamOption) =>
    `${exam.name}${exam.class?.name ? ` - ${exam.class.name}` : ""}${exam.academicYear?.name ? ` (${exam.academicYear.name})` : ""}`;

  const handleExamTemplateFileSelected = async (examId: string, file: File) => {
    if (!examScopedSlot) return;
    if (!file.name.toLowerCase().endsWith(".docx")) {
      alert("Only .docx files are allowed");
      return;
    }
    const exam = exams.find((e) => e.id === examId);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("category", "document");
    formData.append("type", examScopedSlot.type);
    formData.append("name", `${examScopedSlot.label} - ${exam ? examLabel(exam) : examId}`);
    formData.append("examId", examId);

    setUploadingExamId(examId);
    try {
      // BUG FIX: see exams/question-papers/page.tsx's handleUpload for
      // the full explanation.
      const res = await api.post("/templates/upload", formData, {
        headers: { "Content-Type": undefined },
      });
      // Point 5: adds a NEW row alongside any this exam already has
      // (rather than replacing) - the first upload for an exam is
      // auto-marked default by the backend, matching the original
      // single-template behavior for a brand-new exam slot.
      setExamTemplates((prev) => [...prev, res.data.data]);
    } catch (err: any) {
      alert(err.response?.data?.message || "Upload failed");
    } finally {
      setUploadingExamId(null);
      const input = examFileInputs.current[examId];
      if (input) input.value = "";
    }
  };

  const handleExamTemplateDelete = async (examId: string, template: TemplateRecord) => {
    if (!examScopedSlot) return;
    const exam = exams.find((e) => e.id === examId);
    if (!confirm(`Remove the template "${template.name}" uploaded for ${exam ? examLabel(exam) : "this exam"}?`)) return;
    try {
      await api.delete(`/templates/${template.id}`, { params: { category: "document" } });
      setExamTemplates((prev) => prev.filter((t) => t.id !== template.id));
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to delete template");
    }
  };

  const handleSetActiveExamTemplate = async (template: TemplateRecord) => {
    setActivatingId(template.id);
    try {
      await api.patch(`/templates/${template.id}/activate`, null, { params: { category: "document" } });
      setExamTemplates((prev) => prev.map((t) => (t.examId === template.examId ? { ...t, isDefault: t.id === template.id } : t)));
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to set active template");
    } finally {
      setActivatingId(null);
    }
  };

  const renderSlot = (slot: TemplateSlot) => {
    const active = findActiveTemplate(slot);
    const allForSlot = findSlotTemplates(slot);
    const key = slotKey(slot);
    const isUploading = uploadingSlot === key;

    return (
      <div key={key} className="bg-gray-50 border border-gray-200 rounded-lg p-4 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <FileStack className="h-8 w-8 text-primary-600 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-sm">{slot.label}</p>
              <button
                type="button"
                onClick={() => setGuideSlot(slot)}
                className="text-gray-400 hover:text-primary-600 flex-shrink-0"
                title="View placeholder guide"
              >
                <Info className="h-4 w-4" />
              </button>
            </div>
            {active ? (
              <p className="text-xs text-gray-500 mt-0.5 truncate" title={active.name}>
                Active: {active.name} &bull; {formatDate(active.updatedAt)}
              </p>
            ) : (
              <p className="text-xs text-gray-400 mt-0.5">No template uploaded</p>
            )}
            {allForSlot.length > 0 && (
              <p className="text-[11px] text-primary-600 mt-0.5">{allForSlot.length} template{allForSlot.length > 1 ? "s" : ""} uploaded</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 mt-auto flex-wrap">
          {!active && (
            <a
              href={`/sample-templates/${slot.sampleFile}`}
              download
              className="btn-secondary text-xs flex items-center gap-1 px-2 py-1"
              title="Download a ready-made example with sample placeholders"
            >
              <FileDown className="h-3.5 w-3.5" /> Sample
            </a>
          )}

          <button
            type="button"
            onClick={() => fileInputs.current[key]?.click()}
            disabled={isUploading}
            className="btn-primary text-xs flex items-center gap-1 px-2 py-1 disabled:opacity-60"
          >
            {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {isUploading ? "Uploading..." : "Upload New"}
          </button>

          {allForSlot.length > 0 && (
            <button
              type="button"
              onClick={() => setManageSlot(slot)}
              className="btn-secondary text-xs flex items-center gap-1 px-2 py-1"
              title="View, select, or remove any of this slot's uploaded templates"
            >
              <FileStack className="h-3.5 w-3.5" /> Manage ({allForSlot.length})
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

        {slot.examScoped && (
          <button
            type="button"
            onClick={() => openExamScopedPicker(slot)}
            className="text-xs text-primary-600 hover:text-primary-700 hover:underline text-left flex items-center gap-1"
          >
            <CalendarClock className="h-3.5 w-3.5" /> Exam-specific templates
          </button>
        )}
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

      <Modal
        isOpen={!!guideSlot}
        onClose={() => setGuideSlot(null)}
        title={guideSlot ? `${guideSlot.label} - Placeholder Guide` : ""}
        size="lg"
      >
        {guideSlot && (
          <div>
            <p className="text-sm text-gray-600 mb-4">{guideSlot.description}</p>
            <p className="text-sm text-gray-600 mb-4">
              While creating the <code className="bg-gray-100 px-1 rounded">.docx</code> file in Word (or Google Docs),
              type these placeholders exactly as shown (including the double curly braces) wherever you want that
              value to appear. They will be replaced with real data when the document is generated. Click a
              placeholder below to copy it.
            </p>
            <a
              href={`/sample-templates/${guideSlot.sampleFile}`}
              download
              className="inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700 font-medium mb-4"
            >
              <FileDown className="h-4 w-4" /> Download a ready-made sample using these placeholders
            </a>
            {guideSlot.loopSyntaxNote && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 mb-4 text-sm text-amber-800">
                <p className="font-medium mb-1">Multi-row table (repeat per subject)</p>
                <p>{guideSlot.loopSyntaxNote}</p>
              </div>
            )}
            <div className="border rounded-lg divide-y">
              {guideSlot.placeholders.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => copyPlaceholder(p.key)}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-gray-50"
                >
                  <div className="min-w-0">
                    <code className="text-sm font-mono text-primary-700">{`{{${p.key}}}`}</code>
                    <p className="text-xs text-gray-500 mt-0.5">{p.description}</p>
                  </div>
                  {copiedKey === p.key ? (
                    <Check className="h-4 w-4 text-green-600 flex-shrink-0" />
                  ) : (
                    <Copy className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {/* Point 5: Manage all uploaded templates for one slot - select which is active, download/delete any of them. */}
      <Modal
        isOpen={!!manageSlot}
        onClose={() => setManageSlot(null)}
        title={manageSlot ? `${manageSlot.label} - Uploaded Templates` : ""}
        size="lg"
      >
        {manageSlot && (
          <div>
            <p className="text-sm text-gray-600 mb-4">
              Any number of templates can be uploaded for this slot. Click &quot;Set Active&quot; on the one you want used
              when generating this document - only one can be active at a time.
            </p>
            <div className="border rounded-lg divide-y">
              {findSlotTemplates(manageSlot).map((t) => {
                const isActiveRow = manageSlot.category === "certificate" ? t.isActive : t.isDefault;
                return (
                  <div key={t.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate flex items-center gap-2">
                        {t.name}
                        {isActiveRow && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 flex-shrink-0">Active</span>
                        )}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">Uploaded {formatDate(t.updatedAt)}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <a
                        href={resolveUploadUrl(t.templateUrl)}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-secondary text-xs flex items-center gap-1 px-2 py-1"
                        title="Download this template"
                      >
                        <FileDown className="h-3.5 w-3.5" /> Download
                      </a>
                      {!isActiveRow && (
                        <button
                          type="button"
                          onClick={() => handleSetActive(manageSlot, t)}
                          disabled={activatingId === t.id}
                          className="btn-primary text-xs flex items-center gap-1 px-2 py-1 disabled:opacity-60"
                        >
                          {activatingId === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Set Active"}
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => handleDelete(manageSlot, t)}
                          className="text-red-500 hover:text-red-700 p-1"
                          title="Remove this template"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {findSlotTemplates(manageSlot).length === 0 && (
                <p className="text-sm text-gray-400 px-3 py-4">No templates uploaded yet for this slot.</p>
              )}
            </div>
            <div className="flex justify-end pt-4 mt-4 border-t">
              <button type="button" onClick={() => setManageSlot(null)} className="btn-secondary">Close</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!examScopedSlot}
        onClose={closeExamScopedPicker}
        title={examScopedSlot ? `${examScopedSlot.label} - Exam-specific Templates` : ""}
        size="lg"
      >
        {examScopedSlot && (
          <div>
            <p className="text-sm text-gray-600 mb-4">
              Select an exam below, then upload a .docx template just for that exam - it uses the same{" "}
              placeholders as the school-wide {examScopedSlot.label} template above (click the <Info className="h-3.5 w-3.5 inline" />{" "}
              icon on that card for the full placeholder list). Any number of exams can each have their own
              template uploaded at once - every exam you've uploaded one for is listed below the picker.
            </p>

            {loadingExams ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-4">
                  <select
                    className="input-field flex-1"
                    value={selectedExamId}
                    onChange={(e) => setSelectedExamId(e.target.value)}
                  >
                    <option value="">Select an exam...</option>
                    {exams.map((exam) => (
                      <option key={exam.id} value={exam.id}>{examLabel(exam)}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => selectedExamId && examFileInputs.current[selectedExamId]?.click()}
                    disabled={!selectedExamId || uploadingExamId === selectedExamId}
                    className="btn-primary text-sm flex items-center gap-1.5 px-3 py-2 disabled:opacity-60 flex-shrink-0"
                  >
                    {uploadingExamId === selectedExamId ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                    Upload for this exam
                  </button>
                  {selectedExamId && (
                    <input
                      ref={(el) => { examFileInputs.current[selectedExamId] = el; }}
                      type="file"
                      accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleExamTemplateFileSelected(selectedExamId, file);
                        setSelectedExamId("");
                      }}
                    />
                  )}
                </div>

                {exams.length === 0 ? (
                  <p className="text-sm text-gray-400">No exams found - create an exam first under the Exams page.</p>
                ) : examTemplates.length === 0 ? (
                  <p className="text-sm text-gray-400">
                    No exam has its own {examScopedSlot.label} template yet - every exam is currently using the
                    school-wide default.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {exams
                      .filter((exam) => findExamTemplates(exam.id).length > 0)
                      .map((exam) => {
                        const templatesForExam = findExamTemplates(exam.id);
                        return (
                          <div key={exam.id} className="border rounded-lg overflow-hidden">
                            <p className="text-sm font-medium bg-gray-50 px-3 py-2 border-b">{examLabel(exam)}</p>
                            <div className="divide-y">
                              {templatesForExam.map((t) => (
                                <div key={t.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium truncate flex items-center gap-2">
                                      {t.name}
                                      {t.isDefault && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 flex-shrink-0">Active</span>
                                      )}
                                    </p>
                                    <p className="text-xs text-gray-500 mt-0.5">Uploaded {formatDate(t.updatedAt)}</p>
                                  </div>
                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    <a
                                      href={resolveUploadUrl(t.templateUrl)}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="btn-secondary text-xs flex items-center gap-1 px-2 py-1"
                                      title="Download this template"
                                    >
                                      <FileDown className="h-3.5 w-3.5" /> Download
                                    </a>
                                    {!t.isDefault && (
                                      <button
                                        type="button"
                                        onClick={() => handleSetActiveExamTemplate(t)}
                                        disabled={activatingId === t.id}
                                        className="btn-primary text-xs flex items-center gap-1 px-2 py-1 disabled:opacity-60"
                                      >
                                        {activatingId === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Set Active"}
                                      </button>
                                    )}
                                    {canDelete && (
                                      <button
                                        type="button"
                                        onClick={() => handleExamTemplateDelete(exam.id, t)}
                                        className="text-red-500 hover:text-red-700 p-1"
                                        title="Remove this template"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </>
            )}

            <div className="flex justify-end pt-4 mt-4 border-t">
              <button type="button" onClick={closeExamScopedPicker} className="btn-secondary">Close</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
