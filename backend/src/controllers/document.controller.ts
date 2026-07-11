import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendError } from "../utils/response";
import { canAccessBranch } from "../utils/branchScope";
import { canAccessStudentRecord } from "../utils/studentAccess";
import { startPdfResponse, drawHeader, drawFooter, drawKeyValueRow, formatMoney, formatDate } from "../services/pdf.service";

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

    const doc = startPdfResponse(res, `${payment.receiptNo}.pdf`);

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
 * Draws a single ID card (student or staff) at a given position on an
 * already-started PDFDocument. Shared by getStudentIdCardPdf,
 * getStaffIdCardPdf, and the batch class-ID-card generator below so all
 * three produce a visually identical card layout.
 */
const drawIdCard = (
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
  }
) => {
  const { branchName, cardTitle, fullName, idLabel, idValue, lines, footerNote } = params;

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
  doc.fontSize(11).fillColor("#0f172a").text(fullName, infoX, infoY, { width: ID_CARD_WIDTH - 105 });
  infoY += 20;
  doc.fontSize(8).fillColor("#64748b").text(`${idLabel}: ${idValue}`, infoX, infoY); infoY += 13;
  for (const line of lines) {
    doc.fontSize(8).fillColor("#64748b").text(line, infoX, infoY);
    infoY += 13;
  }

  doc.fontSize(7).fillColor("#94a3b8").text(footerNote, startX + 15, startY + ID_CARD_HEIGHT - 20, { width: ID_CARD_WIDTH - 30, align: "center" });
};

/**
 * GET /api/students/:id/id-card
 * Streams a printable student ID card PDF (front side, single card
 * centered on an A4 page for simple home/office printing).
 */
export const getStudentIdCardPdf = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const student = await prisma.student.findUnique({
      where: { id },
      include: {
        user: { select: { name: true } },
        class: { select: { name: true } },
        section: { select: { name: true } },
        branch: { select: { name: true } },
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

    const doc = startPdfResponse(res, `id-card-${student.admissionNo}.pdf`);
    const startX = (doc.page.width - ID_CARD_WIDTH) / 2;

    const lines = [`Class: ${student.class?.name || "-"} - ${student.section?.name || "-"}`];
    if (student.rollNo) lines.push(`Roll No: ${student.rollNo}`);
    if (student.bloodGroup) lines.push(`Blood Group: ${student.bloodGroup}`);

    drawIdCard(doc, startX, 150, {
      branchName: student.branch.name,
      cardTitle: "STUDENT IDENTITY CARD",
      fullName: student.user.name,
      idLabel: "Admission No",
      idValue: student.admissionNo,
      lines,
      footerNote: "If found, please return to the school office.",
    });

    doc.end();
  } catch (error) {
    sendError(res, "Failed to generate ID card", 500, (error as Error).message);
  }
};

/**
 * GET /api/staff/:id/id-card
 * Streams a printable staff ID card PDF, same layout convention as the
 * student ID card above.
 */
export const getStaffIdCardPdf = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const staff = await prisma.staff.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true } },
        branch: { select: { name: true } },
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

    const doc = startPdfResponse(res, `staff-id-card-${staff.employeeId}.pdf`);
    const startX = (doc.page.width - ID_CARD_WIDTH) / 2;

    drawIdCard(doc, startX, 150, {
      branchName: staff.branch.name,
      cardTitle: "STAFF IDENTITY CARD",
      fullName: staff.user.name,
      idLabel: "Employee ID",
      idValue: staff.employeeId,
      lines: [`Designation: ${staff.designation}`, `Department: ${staff.department}`],
      footerNote: "If found, please return to the school office.",
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

    students.forEach((student, index) => {
      if (index > 0) doc.addPage();

      const lines = [`Class: ${student.class?.name || "-"} - ${student.section?.name || "-"}`];
      if (student.rollNo) lines.push(`Roll No: ${student.rollNo}`);
      if (student.bloodGroup) lines.push(`Blood Group: ${student.bloodGroup}`);

      drawIdCard(doc, startX, 150, {
        branchName: student.branch.name,
        cardTitle: "STUDENT IDENTITY CARD",
        fullName: student.user.name,
        idLabel: "Admission No",
        idValue: student.admissionNo,
        lines,
        footerNote: "If found, please return to the school office.",
      });
    });

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

    const doc = startPdfResponse(res, `report-card-${student.admissionNo}-${exam.name}.pdf`);

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

    drawFooter(doc, "This is a computer-generated report card.");

    doc.end();
  } catch (error) {
    sendError(res, "Failed to generate report card", 500, (error as Error).message);
  }
};
