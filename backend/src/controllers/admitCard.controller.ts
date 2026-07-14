import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { canAccessBranch } from "../utils/branchScope";
import { startPdfResponse, sendPdfBuffer, drawHeader, drawFooter, drawKeyValueRow, drawQrCode, formatDate } from "../services/pdf.service";
import { renderTemplateToPdf } from "../services/templateRenderer.service";
import { getActiveDocumentTemplate } from "../services/documentTemplateLookup.service";
import { storage } from "../services/storage.service";
import { evaluateStudentEligibility, EligibilityRuleConfig } from "../services/admitCardEligibility.service";

/**
 * Admit Card generation - separate DocumentTemplate slot (ADMIT_CARD)
 * from the exam RESULT/report-card template (REPORT_CARD, already
 * existed), same template-first/PDFKit-fallback convention as every
 * other document generator in this codebase.
 */

/**
 * Shared core: evaluates eligibility (if a ruleConfig is given),
 * decides the resulting status/allowedSubjectIds, and upserts one
 * AdmitCard row - used by both the single-student and bulk generation
 * endpoints so they can never produce different outcomes for the same
 * inputs.
 *
 * `onIneligible` controls what happens to a student who fails one or
 * more enabled rules:
 *  - "DENY": no admit card capability at all (status DENIED, remarks
 *    explain why, allowedSubjectIds stays empty).
 *  - "PROVISIONAL": status PROVISIONAL, allowedSubjectIds limited to
 *    `provisionalSubjectIds` (subjects already sat/scheduled before
 *    the failure was detected - "sirf is subject ko appear karne ki
 *    anumati"). The student needs a fresh generation run (after fixing
 *    the underlying issue) to get a full/updated card - this never
 *    happens automatically.
 *
 * Regeneration is idempotent per (examId, studentId) via upsert - a
 * second run after a student's situation changes produces an updated
 * card rather than requiring a delete-first step.
 */
const generateAdmitCardCore = async (
  examId: string,
  studentId: string,
  generatedBy: string,
  options: {
    ruleConfig?: EligibilityRuleConfig;
    onIneligible?: "DENY" | "PROVISIONAL";
    provisionalSubjectIds?: string[];
    academicYearStartDate?: Date;
  }
) => {
  const { ruleConfig, onIneligible = "DENY", provisionalSubjectIds = [], academicYearStartDate } = options;

  let status: "ELIGIBLE" | "PROVISIONAL" | "DENIED" = "ELIGIBLE";
  let remarks: string | null = null;
  let allowedSubjectIds: string[] = [];

  if (ruleConfig && (ruleConfig.minAttendancePercent !== undefined || ruleConfig.feesClearedTillMonth) && academicYearStartDate) {
    const result = await evaluateStudentEligibility(studentId, academicYearStartDate, ruleConfig);
    if (!result.eligible) {
      status = onIneligible === "PROVISIONAL" ? "PROVISIONAL" : "DENIED";
      remarks = result.failures.map((f) => f.message).join("; ");
      allowedSubjectIds = onIneligible === "PROVISIONAL" ? provisionalSubjectIds : [];
    }
  }

  const serialNo = `AC-${examId.slice(-6)}-${studentId.slice(-6)}`.toUpperCase();

  const admitCard = await prisma.admitCard.upsert({
    where: { examId_studentId: { examId, studentId } },
    update: { status, remarks, allowedSubjectIds, generatedBy, generatedAt: new Date(), pdfUrl: null },
    create: { examId, studentId, serialNo, status, remarks, allowedSubjectIds, generatedBy },
  });

  return admitCard;
};

/**
 * POST /api/academics/exams/:examId/admit-cards/generate
 * body: { studentId, ruleConfig?, onIneligible? }
 * Single-student generation - admin-driven, no eligibility rules
 * applied unless explicitly passed (defaults to ELIGIBLE/no rules,
 * matching "just issue this one student's card" as the common case).
 */
export const generateAdmitCard = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { examId } = req.params;
    const { studentId, ruleConfig, onIneligible, provisionalSubjectIds } = req.body;

    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: { class: { select: { id: true, branchId: true } }, academicYear: { select: { startDate: true } } },
    });
    if (!exam) { sendError(res, "Exam not found", 404); return; }
    if (!canAccessBranch(req, exam.class.branchId)) { sendError(res, "Exam not found", 404); return; }

    const student = await prisma.student.findUnique({ where: { id: studentId }, select: { id: true, classId: true, branchId: true } });
    if (!student || student.classId !== exam.classId) {
      sendError(res, "Student not found in this exam's class", 404);
      return;
    }
    if (!canAccessBranch(req, student.branchId)) { sendError(res, "Student not found", 404); return; }

    const admitCard = await generateAdmitCardCore(examId, studentId, req.user!.userId, {
      ruleConfig,
      onIneligible,
      provisionalSubjectIds,
      academicYearStartDate: exam.academicYear.startDate,
    });

    sendSuccess(res, admitCard, "Admit card generated", 201);
  } catch (error) { sendError(res, "Failed to generate admit card", 500, (error as Error).message); }
};

/**
 * POST /api/academics/exams/:examId/admit-cards/bulk-generate
 * body: { ruleConfig?, onIneligible? }
 * Evaluates every active student in the exam's class against the
 * enabled rules. Returns a per-student outcome list (same "show what
 * happened to each one" convention as bulkAllocateRoom/
 * bulkGenerateCertificates) rather than a single pass/fail summary.
 */
export const bulkGenerateAdmitCards = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { examId } = req.params;
    const { ruleConfig, onIneligible } = req.body;

    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: { class: { select: { id: true, branchId: true } }, academicYear: { select: { startDate: true } } },
    });
    if (!exam) { sendError(res, "Exam not found", 404); return; }
    if (!canAccessBranch(req, exam.class.branchId)) { sendError(res, "Exam not found", 404); return; }

    const students = await prisma.student.findMany({ where: { classId: exam.classId, isActive: true }, select: { id: true } });
    if (students.length === 0) {
      sendSuccess(res, { total: 0, eligible: 0, provisional: 0, denied: 0, outcomes: [] }, "No active students found in this class");
      return;
    }

    // For PROVISIONAL, restrict the ineligible student to every subject
    // already scheduled for this exam - "sirf is exam ke jo subject
    // schedule ho chuke hain unhi ko appear karne ki anumati" - a
    // simple, deterministic definition of "already sat/scheduled
    // before the failure was detected" rather than trying to infer a
    // partial-sitting timeline.
    const scheduledSubjects = await prisma.examSchedule.findMany({ where: { examId }, select: { subjectId: true } });
    const provisionalSubjectIds = scheduledSubjects.map((s) => s.subjectId);

    const outcomes: { studentId: string; status: string; remarks: string | null }[] = [];
    for (const student of students) {
      const card = await generateAdmitCardCore(examId, student.id, req.user!.userId, {
        ruleConfig,
        onIneligible,
        provisionalSubjectIds,
        academicYearStartDate: exam.academicYear.startDate,
      });
      outcomes.push({ studentId: student.id, status: card.status, remarks: card.remarks });
    }

    const eligible = outcomes.filter((o) => o.status === "ELIGIBLE").length;
    const provisional = outcomes.filter((o) => o.status === "PROVISIONAL").length;
    const denied = outcomes.filter((o) => o.status === "DENIED").length;

    sendSuccess(
      res,
      { total: outcomes.length, eligible, provisional, denied, outcomes },
      `Generated ${outcomes.length} admit card(s): ${eligible} eligible, ${provisional} provisional, ${denied} denied`
    );
  } catch (error) { sendError(res, "Failed to bulk-generate admit cards", 500, (error as Error).message); }
};

/**
 * GET /api/academics/exams/:examId/admit-cards
 * Lists every generated admit card for the exam, with student info -
 * the "review the outcome" list view.
 */
export const getAdmitCards = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { examId } = req.params;

    const exam = await prisma.exam.findUnique({ where: { id: examId }, include: { class: { select: { branchId: true } } } });
    if (!exam) { sendError(res, "Exam not found", 404); return; }
    if (!canAccessBranch(req, exam.class.branchId)) { sendError(res, "Exam not found", 404); return; }

    const admitCards = await prisma.admitCard.findMany({
      where: { examId },
      include: {
        student: {
          select: { id: true, admissionNo: true, rollNo: true, user: { select: { name: true } }, section: { select: { name: true } } },
        },
      },
      orderBy: { student: { rollNo: "asc" } },
    });
    sendSuccess(res, admitCards, "Admit cards fetched");
  } catch (error) { sendError(res, "Failed to fetch admit cards", 500, (error as Error).message); }
};

/**
 * DELETE /api/academics/exams/:examId/admit-cards/:studentId
 * Clears one student's admit card record entirely (e.g. to force a
 * completely fresh generate rather than the upsert's "update in
 * place" - useful if an admin wants to remove a DENIED record so the
 * student doesn't show up in the list at all until re-evaluated).
 */
export const deleteAdmitCard = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { examId, studentId } = req.params;

    const admitCard = await prisma.admitCard.findUnique({
      where: { examId_studentId: { examId, studentId } },
      include: { student: { select: { branchId: true } } },
    });
    if (!admitCard) { sendError(res, "Admit card not found", 404); return; }
    if (!canAccessBranch(req, admitCard.student.branchId)) { sendError(res, "Admit card not found", 404); return; }

    if (admitCard.pdfUrl) await storage.deleteByUrl(admitCard.pdfUrl).catch(() => undefined);
    await prisma.admitCard.delete({ where: { id: admitCard.id } });
    sendSuccess(res, null, "Admit card deleted");
  } catch (error) { sendError(res, "Failed to delete admit card", 500, (error as Error).message); }
};

/**
 * GET /api/academics/exams/:examId/admit-cards/:studentId/pdf
 * Streams the admit card PDF - DENIED students get a 403 (no card to
 * download), ELIGIBLE/PROVISIONAL get the PDF (PROVISIONAL shows only
 * its allowedSubjectIds, with a visible remarks banner explaining the
 * restriction).
 */
export const getAdmitCardPdf = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { examId, studentId } = req.params;

    const admitCard = await prisma.admitCard.findUnique({ where: { examId_studentId: { examId, studentId } } });
    if (!admitCard) { sendError(res, "Admit card not found - generate it first", 404); return; }
    if (admitCard.status === "DENIED") {
      sendError(res, `Admit card denied: ${admitCard.remarks || "eligibility rules not met"}`, 403);
      return;
    }

    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: { class: { select: { name: true, branchId: true } }, academicYear: { select: { name: true } } },
    });
    if (!exam) { sendError(res, "Exam not found", 404); return; }
    if (!canAccessBranch(req, exam.class.branchId)) { sendError(res, "Exam not found", 404); return; }

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: { user: { select: { name: true } }, class: { select: { name: true } }, section: { select: { name: true } }, branch: { select: { name: true } } },
    });
    if (!student) { sendError(res, "Student not found", 404); return; }

    const schedule = await prisma.examSchedule.findMany({
      where: {
        examId,
        ...(admitCard.allowedSubjectIds.length > 0 ? { subjectId: { in: admitCard.allowedSubjectIds } } : {}),
      },
      include: { subject: { select: { name: true, code: true } }, room: { select: { roomNo: true, name: true } } },
      orderBy: [{ examDate: "asc" }, { startTime: "asc" }],
    });

    const filename = `admit-card-${student.admissionNo}-${exam.name}.pdf`;

    // Exam-specific template first (if this exam has its own uploaded
    // Admit Card layout), falling back to the school-wide default -
    // see documentTemplateLookup.service.ts.
    const admitCardTemplate = await getActiveDocumentTemplate("ADMIT_CARD", examId);
    const fromTemplate = await renderTemplateToPdf(admitCardTemplate?.templateUrl, {
      studentName: student.user.name,
      admissionNo: student.admissionNo,
      className: student.class?.name || "-",
      sectionName: student.section?.name || "-",
      examName: exam.name,
      serialNo: admitCard.serialNo,
      status: admitCard.status,
      remarks: admitCard.remarks || "",
      branchName: student.branch.name,
      subjects: schedule.map((s) => ({
        subjectName: s.subject.name,
        examDate: formatDate(s.examDate),
        startTime: s.startTime,
        endTime: s.endTime,
        roomNo: s.room ? `${s.room.roomNo}${s.room.name ? ` (${s.room.name})` : ""}` : "-",
      })),
    });
    if (fromTemplate) {
      sendPdfBuffer(res, filename, fromTemplate);
      return;
    }

    const doc = startPdfResponse(res, filename);
    drawHeader(doc, student.branch.name, `Admit Card - ${exam.name} (${exam.academicYear.name})`);

    const leftX = doc.page.margins.left;
    let y = doc.y;
    drawKeyValueRow(doc, "Student Name", student.user.name, leftX, y); y += 18;
    drawKeyValueRow(doc, "Admission No", student.admissionNo, leftX, y); y += 18;
    drawKeyValueRow(doc, "Class / Section", `${student.class?.name || "-"} / ${student.section?.name || "-"}`, leftX, y); y += 18;
    drawKeyValueRow(doc, "Serial No", admitCard.serialNo, leftX, y); y += 18;
    doc.y = y;

    if (admitCard.status === "PROVISIONAL") {
      doc.moveDown(0.4);
      doc.fontSize(10).fillColor("#b45309").text(
        `PROVISIONAL ADMIT CARD - restricted to the subjects listed below. Reason: ${admitCard.remarks || "eligibility rules not fully met"}. A fresh admit card must be generated once resolved.`,
        { width: doc.page.width - doc.page.margins.left - doc.page.margins.right }
      );
      doc.moveDown(0.6);
    }

    // Subject-wise schedule table.
    const colX = [leftX, leftX + 150, leftX + 250, leftX + 340];
    doc.fontSize(10).fillColor("#ffffff");
    doc.rect(leftX, doc.y, doc.page.width - doc.page.margins.left - doc.page.margins.right, 22).fill("#334155");
    const headerY = doc.y - 22 + 6;
    doc.fillColor("#ffffff").text("Subject", colX[0] + 8, headerY);
    doc.text("Date", colX[1], headerY);
    doc.text("Time", colX[2], headerY);
    doc.text("Room", colX[3], headerY);

    let rowY = doc.y;
    if (schedule.length === 0) {
      doc.fontSize(9).fillColor("#94a3b8").text("No subjects scheduled yet for this exam.", leftX + 8, rowY + 5);
      rowY += 20;
    } else {
      schedule.forEach((s, i) => {
        const rowHeight = 20;
        if (i % 2 === 1) {
          doc.rect(leftX, rowY, doc.page.width - doc.page.margins.left - doc.page.margins.right, rowHeight).fill("#f1f5f9");
        }
        doc.fillColor("#0f172a").fontSize(9);
        doc.text(s.subject.name, colX[0] + 8, rowY + 5);
        doc.text(formatDate(s.examDate), colX[1], rowY + 5);
        doc.text(`${s.startTime}-${s.endTime}`, colX[2], rowY + 5);
        doc.text(s.room ? s.room.roomNo : "-", colX[3], rowY + 5);
        rowY += rowHeight;
      });
    }
    doc.y = rowY + 10;

    const qrSize = 60;
    await drawQrCode(
      doc,
      `Admit Card: ${admitCard.serialNo}\n${student.branch.name}\nStudent: ${student.user.name} (${student.admissionNo})\nExam: ${exam.name}\nStatus: ${admitCard.status}`,
      doc.page.width - doc.page.margins.right - qrSize,
      doc.page.height - doc.page.margins.bottom - qrSize - 26,
      qrSize,
      "Scan for admit card summary"
    );

    drawFooter(doc, `${student.branch.name} - Carry this admit card to every exam sitting listed above.`);

    doc.end();
  } catch (error) { sendError(res, "Failed to generate admit card PDF", 500, (error as Error).message); }
};
