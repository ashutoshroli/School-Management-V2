import { Response } from "express";
import { ParentRelation } from "@prisma/client";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendError } from "../utils/response";
import { canAccessBranch } from "../utils/branchScope";
import { canAccessStudentRecord } from "../utils/studentAccess";
import { startPdfResponse, sendPdfBuffer, drawHeader, drawFooter, drawKeyValueRow, drawQrCode, formatMoney, formatDate } from "../services/pdf.service";
import { renderTemplateToPdf, TemplateData } from "../services/templateRenderer.service";
import { getActiveDocumentTemplate } from "../services/documentTemplateLookup.service";
import { getParentName } from "./certificate.controller";

/**
 * GET /api/fees/payments/:id/receipt
 * Streams a PDF fee receipt for a single Payment record.
 * Accessible to branch finance staff, or the paying student/parent
 * themselves (self-service download after paying online).
 */
export const getPaymentReceiptPdf = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: {
        branch: { select: { name: true, address: true, city: true, state: true, pincode: true, phone: true } },
        student: {
          select: {
            branchId: true,
            admissionNo: true,
            rollNo: true,
            user: { select: { name: true } },
            class: { select: { name: true } },
            section: { select: { name: true } },
          },
        },
        feeAssignment: {
          include: { feeStructure: { include: { feeCategory: { select: { name: true } } } } },
        },
      },
    });

    if (!payment) {
      sendError(res, "Payment not found", 404);
      return;
    }

    if (!canAccessBranch(req, payment.branchId) && !(await canAccessStudentRecord(req, payment.studentId))) {
      sendError(res, "Payment not found", 404);
      return;
    }

    const filename = `${payment.receiptNo}.pdf`;
    const feeReceiptTemplate = await getActiveDocumentTemplate("FEE_RECEIPT");
    const fromTemplate = await renderTemplateToPdf(feeReceiptTemplate?.templateUrl, {
      receiptNo: payment.receiptNo,
      studentName: payment.student.user.name,
      admissionNo: payment.student.admissionNo,
      className: payment.student.class?.name || "-",
      sectionName: payment.student.section?.name || "-",
      feeCategoryName: payment.feeAssignment.feeStructure.feeCategory.name,
      amount: formatMoney(payment.amount),
      lateFeeCharged: Number(payment.lateFeeCharged) > 0 ? formatMoney(payment.lateFeeCharged) : "",
      paymentMode: payment.paymentMode.replace(/_/g, " "),
      transactionId: payment.transactionId || "",
      paidAt: formatDate(payment.paidAt),
      branchName: payment.branch.name,
      branchAddress: [payment.branch.address, payment.branch.city, payment.branch.state, payment.branch.pincode].filter(Boolean).join(", "),
      branchPhone: payment.branch.phone || "",
    });
    if (fromTemplate) {
      sendPdfBuffer(res, filename, fromTemplate);
      return;
    }

    const doc = startPdfResponse(res, filename);

    drawHeader(doc, payment.branch.name, "Fee Payment Receipt");

    doc.fontSize(13).fillColor("#0f172a").text(`Receipt No: ${payment.receiptNo}`, { align: "right" });
    doc.fontSize(10).fillColor("#475569").text(`Date: ${formatDate(payment.paidAt)}`, { align: "right" });
    doc.moveDown(1);

    const leftX = doc.page.margins.left;
    let y = doc.y;
    drawKeyValueRow(doc, "Student Name", payment.student.user.name, leftX, y); y += 18;
    drawKeyValueRow(doc, "Admission No", payment.student.admissionNo, leftX, y); y += 18;
    drawKeyValueRow(doc, "Class / Section", `${payment.student.class?.name || "-"} / ${payment.student.section?.name || "-"}`, leftX, y); y += 18;
    drawKeyValueRow(doc, "Fee Category", payment.feeAssignment.feeStructure.feeCategory.name, leftX, y); y += 18;
    drawKeyValueRow(doc, "Payment Mode", payment.paymentMode.replace(/_/g, " "), leftX, y); y += 18;
    if (payment.transactionId) {
      drawKeyValueRow(doc, "Transaction ID", payment.transactionId, leftX, y); y += 18;
    }
    doc.y = y + 10;

    // Amount table
    doc.moveTo(leftX, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor("#cbd5e1").stroke();
    doc.moveDown(0.5);

    const rowY1 = doc.y;
    doc.fontSize(10).fillColor("#475569").text("Amount Paid", leftX, rowY1);
    doc.fontSize(10).fillColor("#0f172a").text(formatMoney(payment.amount), leftX, rowY1, { align: "right", width: doc.page.width - doc.page.margins.left - doc.page.margins.right });
    doc.moveDown(0.6);

    if (Number(payment.lateFeeCharged) > 0) {
      const rowY2 = doc.y;
      doc.fontSize(10).fillColor("#475569").text("Late Fee Charged", leftX, rowY2);
      doc.fontSize(10).fillColor("#b91c1c").text(formatMoney(payment.lateFeeCharged), leftX, rowY2, { align: "right", width: doc.page.width - doc.page.margins.left - doc.page.margins.right });
      doc.moveDown(0.6);
    }

    doc.moveTo(leftX, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor("#cbd5e1").stroke();
    doc.moveDown(0.5);

    const totalY = doc.y;
    doc.fontSize(12).fillColor("#0f172a").text("Total Received", leftX, totalY, { continued: false });
    doc.fontSize(12).fillColor("#15803d").text(
      formatMoney(Number(payment.amount) + Number(payment.lateFeeCharged)),
      leftX,
      totalY,
      { align: "right", width: doc.page.width - doc.page.margins.left - doc.page.margins.right }
    );

    doc.moveDown(2);
    doc.fontSize(9).fillColor("#94a3b8").text(
      `Payment status: ${payment.status}. This is a computer-generated receipt and does not require a signature.`,
      { align: "left" }
    );

    // QR code summarizing the payment, so the receipt can be verified
    // at a glance (e.g. by a parent double-checking a printed copy)
    // without a dedicated "verify receipt" web page. Placed at a fixed
    // bottom-right position (independent of the content flow above) so
    // it can never overlap the amount table regardless of how many
    // optional rows were rendered.
    const qrSize = 60;
    await drawQrCode(
      doc,
      `Fee Receipt: ${payment.receiptNo}\n${payment.branch.name}\nStudent: ${payment.student.user.name} (${payment.student.admissionNo})\nAmount: ${formatMoney(payment.amount)}\nMode: ${payment.paymentMode.replace(/_/g, " ")}\nDate: ${formatDate(payment.paidAt)}`,
      doc.page.width - doc.page.margins.right - qrSize,
      doc.page.height - doc.page.margins.bottom - qrSize - 26,
      qrSize,
      "Scan for receipt summary"
    );

    drawFooter(doc, `${payment.branch.name} - ${[payment.branch.address, payment.branch.city, payment.branch.state, payment.branch.pincode].filter(Boolean).join(", ")}`);

    doc.end();
  } catch (error) {
    sendError(res, "Failed to generate receipt", 500, (error as Error).message);
  }
};

// Card dimensions roughly matching a standard ID card (in points,
// scaled up ~2x for print clarity).
const ID_CARD_WIDTH = 320;
const ID_CARD_HEIGHT = 200;

/**
 * Builds the plain-text payload encoded into an ID card's QR code.
 * There's no dedicated public "verify this ID card" web page (unlike
 * certificates, which link to /verify-certificate/:serialNo) - a
 * scanned ID card just needs to show the holder's identity at a
 * glance (e.g. a security guard scanning it), so a short structured
 * text blob is enough and needs no new backend endpoint.
 */
const buildIdCardQrData = (branchName: string, role: string, fullName: string, idValue: string): string =>
  `${branchName}\n${role}: ${fullName}\nID: ${idValue}`;

/**
 * Draws a single ID card (student or staff) at a given position on an
 * already-started PDFDocument. Shared by getStudentIdCardPdf,
 * getStaffIdCardPdf, and the batch class-ID-card generator below so all
 * three produce a visually identical card layout.
 */
const drawIdCard = async (
  doc: any,
  startX: number,
  startY: number,
  params: {
    branchName: string;
    cardTitle: string;
    fullName: string;
    idLabel: string;
    idValue: string;
    lines: string[];
    footerNote: string;
    qrData: string;
  }
) => {
  const { branchName, cardTitle, fullName, idLabel, idValue, lines, footerNote, qrData } = params;

  doc.roundedRect(startX, startY, ID_CARD_WIDTH, ID_CARD_HEIGHT, 10).fillAndStroke("#f8fafc", "#cbd5e1");

  doc.fontSize(13).fillColor("#1e293b").text(branchName, startX + 15, startY + 15, { width: ID_CARD_WIDTH - 30, align: "center" });
  doc.fontSize(9).fillColor("#64748b").text(cardTitle, startX + 15, startY + 34, { width: ID_CARD_WIDTH - 30, align: "center" });

  doc.moveTo(startX + 15, startY + 52).lineTo(startX + ID_CARD_WIDTH - 15, startY + 52).strokeColor("#cbd5e1").stroke();

  // Placeholder avatar box (actual photo upload is a future
  // enhancement - once a photo URL is reliably available via the
  // upload service for every student/staff record, this box can be
  // replaced with doc.image(photoPath, ...)).
  doc.roundedRect(startX + 15, startY + 62, 60, 70, 4).fillAndStroke("#e2e8f0", "#cbd5e1");
  doc.fontSize(7).fillColor("#94a3b8").text("PHOTO", startX + 15, startY + 92, { width: 60, align: "center" });

  let infoY = startY + 65;
  const infoX = startX + 90;
  const infoWidth = ID_CARD_WIDTH - 105 - 55; // leave room for the QR box on the right
  doc.fontSize(11).fillColor("#0f172a").text(fullName, infoX, infoY, { width: infoWidth });
  infoY += 20;
  doc.fontSize(8).fillColor("#64748b").text(`${idLabel}: ${idValue}`, infoX, infoY, { width: infoWidth }); infoY += 13;
  for (const line of lines) {
    doc.fontSize(8).fillColor("#64748b").text(line, infoX, infoY, { width: infoWidth });
    infoY += 13;
  }

  // Small QR code in the card's top-right area, scannable to confirm
  // the holder's identity without needing to read the printed text.
  await drawQrCode(doc, qrData, startX + ID_CARD_WIDTH - 60, startY + 65, 45);

  doc.fontSize(7).fillColor("#94a3b8").text(footerNote, startX + 15, startY + ID_CARD_HEIGHT - 20, { width: ID_CARD_WIDTH - 30, align: "center" });
};

/**
 * GET /api/students/:id/id-card
 * Streams a printable student ID card PDF. Tries the admin-uploaded
 * ID_CARD CertificateTemplate first (filled with this student's data
 * and converted via LibreOffice - see templateRenderer.service.ts);
 * falls back to the hardcoded card layout below when no usable
 * template is available (nothing uploaded yet, or LibreOffice isn't
 * installed on this host).
 */
export const getStudentIdCardPdf = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const student = await prisma.student.findUnique({
      where: { id },
      include: {
        user: { select: { name: true, avatar: true } },
        class: { select: { name: true } },
        section: { select: { name: true } },
        branch: { select: { name: true, address: true, city: true, state: true, pincode: true, phone: true } },
        parents: { include: { parent: { select: { relation: true, user: { select: { name: true } } } } } },
        // Only the most recent "photo"-typed upload matters for the
        // card - a re-uploaded photo should replace the old one on the
        // card, not add a second row to pick from.
        documents: { where: { type: "photo" }, orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    if (!student) {
      sendError(res, "Student not found", 404);
      return;
    }

    if (!canAccessBranch(req, student.branchId) && !(await canAccessStudentRecord(req, id))) {
      sendError(res, "Student not found", 404);
      return;
    }

    const filename = `id-card-${student.admissionNo}.pdf`;
    const template = await prisma.certificateTemplate.findFirst({ where: { type: "ID_CARD", isActive: true } });
    const fromTemplate = await renderTemplateToPdf(template?.templateUrl, {
      studentName: student.user.name,
      admissionNo: student.admissionNo,
      // Documented on the Templates page's ID Card placeholder guide,
      // but previously never actually included here - they'd always
      // come out blank in a real uploaded template (see
      // BACKEND_UX_GAP_PLAN.md Phase 5).
      fatherName: getParentName(student.parents, ParentRelation.FATHER),
      motherName: getParentName(student.parents, ParentRelation.MOTHER),
      dateOfBirth: formatDate(student.dateOfBirth),
      className: student.class?.name || "-",
      sectionName: student.section?.name || "-",
      bloodGroup: student.bloodGroup || "-",
      cardId: student.cardId || "-",
      address: student.address || "-",
      // A dedicated StudentDocument (type="photo") is the intended
      // source; user.avatar (Google OAuth profile picture) is only a
      // fallback for students who signed in that way but never
      // uploaded a proper ID-card photo.
      photoUrl: student.documents[0]?.fileUrl || student.user.avatar || "",
      branchName: student.branch.name,
      branchAddress: [student.branch.address, student.branch.city, student.branch.state, student.branch.pincode].filter(Boolean).join(", "),
      branchPhone: student.branch.phone || "",
    });
    if (fromTemplate) {
      sendPdfBuffer(res, filename, fromTemplate);
      return;
    }

    const doc = startPdfResponse(res, filename);
    const startX = (doc.page.width - ID_CARD_WIDTH) / 2;

    const lines = [`Class: ${student.class?.name || "-"} - ${student.section?.name || "-"}`];
    if (student.rollNo) lines.push(`Roll No: ${student.rollNo}`);
    if (student.bloodGroup) lines.push(`Blood Group: ${student.bloodGroup}`);

    await drawIdCard(doc, startX, 150, {
      branchName: student.branch.name,
      cardTitle: "STUDENT IDENTITY CARD",
      fullName: student.user.name,
      idLabel: "Admission No",
      idValue: student.admissionNo,
      lines,
      footerNote: "If found, please return to the school office.",
      qrData: buildIdCardQrData(student.branch.name, "Student", student.user.name, student.admissionNo),
    });

    doc.end();
  } catch (error) {
    sendError(res, "Failed to generate ID card", 500, (error as Error).message);
  }
};

/**
 * GET /api/staff/:id/id-card
 * Streams a printable staff ID card PDF - same template-first, PDFKit-
 * fallback convention as the student ID card above (shares the same
 * ID_CARD CertificateTemplate slot).
 */
export const getStaffIdCardPdf = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const staff = await prisma.staff.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true } },
        branch: { select: { name: true, address: true, city: true, state: true, pincode: true, phone: true } },
      },
    });

    if (!staff) {
      sendError(res, "Staff not found", 404);
      return;
    }

    // Staff can download their own card; branch admin staff can
    // download any card within their branch.
    const isSelf = req.user?.userId === staff.user.id;
    if (!canAccessBranch(req, staff.branchId) && !isSelf) {
      sendError(res, "Staff not found", 404);
      return;
    }

    const filename = `staff-id-card-${staff.employeeId}.pdf`;
    const template = await prisma.certificateTemplate.findFirst({ where: { type: "ID_CARD", isActive: true } });
    const fromTemplate = await renderTemplateToPdf(template?.templateUrl, {
      studentName: staff.user.name,
      admissionNo: staff.employeeId,
      cardId: staff.cardId || "-",
      address: staff.address || "-",
      branchName: staff.branch.name,
      branchAddress: [staff.branch.address, staff.branch.city, staff.branch.state, staff.branch.pincode].filter(Boolean).join(", "),
      branchPhone: staff.branch.phone || "",
    });
    if (fromTemplate) {
      sendPdfBuffer(res, filename, fromTemplate);
      return;
    }

    const doc = startPdfResponse(res, filename);
    const startX = (doc.page.width - ID_CARD_WIDTH) / 2;

    await drawIdCard(doc, startX, 150, {
      branchName: staff.branch.name,
      cardTitle: "STAFF IDENTITY CARD",
      fullName: staff.user.name,
      idLabel: "Employee ID",
      idValue: staff.employeeId,
      lines: [`Designation: ${staff.designation}`, `Department: ${staff.department}`],
      footerNote: "If found, please return to the school office.",
      qrData: buildIdCardQrData(staff.branch.name, "Staff", staff.user.name, staff.employeeId),
    });

    doc.end();
  } catch (error) {
    sendError(res, "Failed to generate ID card", 500, (error as Error).message);
  }
};

/**
 * GET /api/students/id-cards/batch?classId=&sectionId=
 * Streams a single multi-page PDF containing one ID card per page for
 * every active student in the given class (optionally narrowed to one
 * section) - lets office staff print an entire class's cards in one
 * job instead of downloading each student's card individually.
 * Branch-admin/teacher only (bulk PII export), unlike the single-card
 * endpoint which self-service students/parents can also hit.
 */
export const getClassIdCardsBatchPdf = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { classId, sectionId } = req.query as { classId?: string; sectionId?: string };
    if (!classId) {
      sendError(res, "classId query parameter is required", 400);
      return;
    }

    const cls = await prisma.class.findUnique({ where: { id: classId }, select: { branchId: true, name: true } });
    if (!cls) {
      sendError(res, "Class not found", 404);
      return;
    }
    if (!canAccessBranch(req, cls.branchId)) {
      sendError(res, "Class not found", 404);
      return;
    }

    const students = await prisma.student.findMany({
      where: { classId, ...(sectionId ? { sectionId } : {}), isActive: true },
      include: {
        user: { select: { name: true } },
        class: { select: { name: true } },
        section: { select: { name: true } },
        branch: { select: { name: true } },
      },
      orderBy: [{ section: { name: "asc" } }, { rollNo: "asc" }],
    });

    if (students.length === 0) {
      sendError(res, "No active students found for this class/section", 404);
      return;
    }

    const doc = startPdfResponse(res, `id-cards-${cls.name.replace(/\s+/g, "-")}.pdf`);
    const startX = (doc.page.width - ID_CARD_WIDTH) / 2;

    // Sequential for..of (not forEach/Promise.all) since drawIdCard is
    // now async (draws a QR code per card) and each card must finish
    // drawing on the current page before addPage() starts the next one.
    for (let index = 0; index < students.length; index++) {
      const student = students[index];
      if (index > 0) doc.addPage();

      const lines = [`Class: ${student.class?.name || "-"} - ${student.section?.name || "-"}`];
      if (student.rollNo) lines.push(`Roll No: ${student.rollNo}`);
      if (student.bloodGroup) lines.push(`Blood Group: ${student.bloodGroup}`);

      await drawIdCard(doc, startX, 150, {
        branchName: student.branch.name,
        cardTitle: "STUDENT IDENTITY CARD",
        fullName: student.user.name,
        idLabel: "Admission No",
        idValue: student.admissionNo,
        lines,
        footerNote: "If found, please return to the school office.",
        qrData: buildIdCardQrData(student.branch.name, "Student", student.user.name, student.admissionNo),
      });
    }

    doc.end();
  } catch (error) {
    sendError(res, "Failed to generate batch ID cards", 500, (error as Error).message);
  }
};

/**
 * GET /api/academics/exams/:examId/report-card/:studentId
 * Streams a marksheet/report-card PDF for one student's results in one
 * exam. Reuses the same subject-wise aggregation as getExamResults but
 * scoped to a single student, then renders it as a PDF.
 */
export const getReportCardPdf = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { examId, studentId } = req.params;

    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: { class: { select: { name: true, branchId: true } }, academicYear: { select: { name: true } } },
    });
    if (!exam) {
      sendError(res, "Exam not found", 404);
      return;
    }

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: { user: { select: { name: true } }, class: { select: { name: true } }, section: { select: { name: true } }, branch: { select: { name: true } } },
    });
    if (!student) {
      sendError(res, "Student not found", 404);
      return;
    }

    if (!canAccessBranch(req, student.branchId) && !(await canAccessStudentRecord(req, studentId))) {
      sendError(res, "Student not found", 404);
      return;
    }

    if (!exam.isPublished && !canAccessBranch(req, student.branchId)) {
      // Students/parents shouldn't be able to peek at unpublished results.
      sendError(res, "Results for this exam have not been published yet", 403);
      return;
    }

    const marks = await prisma.mark.findMany({
      where: { examId, studentId },
      include: { subject: { select: { name: true, code: true } } },
      orderBy: { subject: { name: "asc" } },
    });

    if (marks.length === 0) {
      sendError(res, "No marks recorded for this student in this exam", 404);
      return;
    }

    const totalObtained = marks.reduce((sum, m) => sum + Number(m.obtainedMarks), 0);
    const totalMax = marks.reduce((sum, m) => sum + Number(m.maxMarks), 0);
    const percentage = totalMax > 0 ? (totalObtained / totalMax) * 100 : 0;

    const filename = `report-card-${student.admissionNo}-${exam.name}.pdf`;

    // Report cards have one row per subject, which a flat placeholder
    // map (a single {{subjectName}}) can't represent for more than one
    // subject. docxtemplater's loop syntax ({#marks}...{/marks}) lets a
    // school's template repeat a table row per subject - `marks` (an
    // array) is passed alongside the flat top-level fields so a
    // template can use either depending on how it was authored (a
    // simple template with just {{subjectName}} for a single row, or a
    // real per-subject table via the loop).
    const reportCardTemplate = await getActiveDocumentTemplate("REPORT_CARD");
    const fromTemplate = await renderTemplateToPdf(reportCardTemplate?.templateUrl, {
      studentName: student.user.name,
      admissionNo: student.admissionNo,
      className: student.class?.name || "-",
      sectionName: student.section?.name || "-",
      examName: exam.name,
      totalMarks: `${totalObtained} / ${totalMax}`,
      percentage: `${percentage.toFixed(2)}%`,
      // First subject's values, for templates that only expect a single
      // {{subjectName}}/{{maxMarks}}/{{obtainedMarks}}/{{grade}} row.
      subjectName: marks[0]?.subject.name || "-",
      maxMarks: marks[0] ? String(marks[0].maxMarks) : "-",
      obtainedMarks: marks[0] ? String(marks[0].obtainedMarks) : "-",
      grade: marks[0]?.grade || "-",
      marks: marks.map((m) => ({
        subjectName: m.subject.name,
        maxMarks: String(m.maxMarks),
        obtainedMarks: String(m.obtainedMarks),
        grade: m.grade || "-",
      })),
    });
    if (fromTemplate) {
      sendPdfBuffer(res, filename, fromTemplate);
      return;
    }

    const doc = startPdfResponse(res, filename);

    drawHeader(doc, student.branch.name, `Report Card - ${exam.name} (${exam.academicYear.name})`);

    const leftX = doc.page.margins.left;
    let y = doc.y;
    drawKeyValueRow(doc, "Student Name", student.user.name, leftX, y); y += 18;
    drawKeyValueRow(doc, "Admission No", student.admissionNo, leftX, y); y += 18;
    drawKeyValueRow(doc, "Class / Section", `${student.class?.name || "-"} / ${student.section?.name || "-"}`, leftX, y); y += 24;
    doc.y = y;

    // Table header
    const colX = [leftX, leftX + 220, leftX + 320, leftX + 400];
    doc.fontSize(10).fillColor("#ffffff");
    doc.rect(leftX, doc.y, doc.page.width - doc.page.margins.left - doc.page.margins.right, 22).fill("#334155");
    const headerY = doc.y - 22 + 6;
    doc.fillColor("#ffffff").text("Subject", colX[0] + 8, headerY);
    doc.text("Max Marks", colX[1], headerY);
    doc.text("Obtained", colX[2], headerY);
    doc.text("Grade", colX[3], headerY);

    let rowY = doc.y;
    marks.forEach((m, i) => {
      const rowHeight = 20;
      if (i % 2 === 1) {
        doc.rect(leftX, rowY, doc.page.width - doc.page.margins.left - doc.page.margins.right, rowHeight).fill("#f1f5f9");
      }
      doc.fillColor("#0f172a").fontSize(9);
      doc.text(m.subject.name, colX[0] + 8, rowY + 5);
      doc.text(String(m.maxMarks), colX[1], rowY + 5);
      doc.text(String(m.obtainedMarks), colX[2], rowY + 5);
      doc.text(m.grade || "-", colX[3], rowY + 5);
      rowY += rowHeight;
    });

    doc.y = rowY + 10;
    doc.moveTo(leftX, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor("#cbd5e1").stroke();
    doc.moveDown(0.6);

    doc.fontSize(11).fillColor("#0f172a").text(`Total: ${totalObtained} / ${totalMax}`, leftX);
    doc.fontSize(11).fillColor("#0f172a").text(`Percentage: ${percentage.toFixed(2)}%`, leftX);
    doc.fontSize(11).fillColor(percentage >= 33 ? "#15803d" : "#b91c1c").text(
      percentage >= 33 ? "Result: PASS" : "Result: NEEDS IMPROVEMENT",
      leftX
    );

    // QR code summarizing the result, fixed to the bottom-right of the
    // page so it's unaffected by however many subject rows preceded it.
    const qrSize = 60;
    await drawQrCode(
      doc,
      `Report Card: ${exam.name} (${exam.academicYear.name})\n${student.branch.name}\nStudent: ${student.user.name} (${student.admissionNo})\nClass: ${student.class?.name || "-"} - ${student.section?.name || "-"}\nTotal: ${totalObtained}/${totalMax} (${percentage.toFixed(2)}%)`,
      doc.page.width - doc.page.margins.right - qrSize,
      doc.page.height - doc.page.margins.bottom - qrSize - 26,
      qrSize,
      "Scan for result summary"
    );

    drawFooter(doc, "This is a computer-generated report card.");

    doc.end();
  } catch (error) {
    sendError(res, "Failed to generate report card", 500, (error as Error).message);
  }
};
