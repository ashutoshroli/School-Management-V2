import { Request, Response } from "express";
import prisma from "../config/database";
import { sendSuccess, sendError } from "../utils/response";
import { config } from "../config";
import { isRazorpayConfigured, getRazorpayClient } from "../config/razorpay";
import { getValidatedFeeAssignment } from "../services/feePayment.service";

/**
 * Public (no-auth) landing-page portals: result lookup, fee status
 * lookup + online payment hand-off, careers, and a public notice
 * board. All identity-sensitive lookups here are keyed on
 * `admissionNo + dateOfBirth` (the closest thing to a public
 * "registration number + DOB" pair this schema has - there's no
 * separate registration-number field) and are deliberately generic on
 * failure ("no matching record found") so a wrong admissionNo vs a
 * wrong dateOfBirth can't be distinguished by an attacker probing for
 * valid admission numbers. Every route using these should be mounted
 * behind `publicLookupLimiter` (see middleware/rateLimiter.ts).
 */

/**
 * Same-day comparison for a DateTime column against a plain
 * "YYYY-MM-DD" input - dateOfBirth is stored with a time component
 * (midnight UTC, from how it's created elsewhere), so a naive
 * `dateOfBirth: new Date(input)` equality check in Prisma would only
 * match if the input parses to the EXACT same instant, which is
 * fragile across timezones. Comparing the UTC Y-M-D components instead
 * is robust to that.
 */
const isSameCalendarDay = (stored: Date, inputDateStr: string): boolean => {
  const input = new Date(inputDateStr);
  if (isNaN(input.getTime())) return false;
  return (
    stored.getUTCFullYear() === input.getUTCFullYear() &&
    stored.getUTCMonth() === input.getUTCMonth() &&
    stored.getUTCDate() === input.getUTCDate()
  );
};

/**
 * Shared lookup: finds exactly one ACTIVE student matching both
 * admissionNo and dateOfBirth. Returns null (no student, or DOB
 * mismatch) without ever revealing which of the two was wrong.
 */
const findStudentByAdmissionAndDob = async (admissionNo: string, dateOfBirth: string) => {
  const student = await prisma.student.findUnique({
    where: { admissionNo },
    include: {
      user: { select: { name: true } },
      class: { select: { id: true, name: true } },
      section: { select: { name: true } },
      branch: { select: { id: true, name: true } },
    },
  });
  if (!student || !student.isActive) return null;
  if (!isSameCalendarDay(student.dateOfBirth, dateOfBirth)) return null;
  return student;
};

/**
 * POST /api/public/results/lookup
 * body: { admissionNo, dateOfBirth }
 * Returns only PUBLISHED exam results (never a draft/unpublished
 * exam's marks) - same minimal-disclosure principle as
 * verifyCertificate: confirm identity, then return only what's
 * actually meant to be visible.
 */
export const lookupPublicResults = async (req: Request, res: Response): Promise<void> => {
  try {
    const { admissionNo, dateOfBirth } = req.body;
    if (!admissionNo || !dateOfBirth) {
      sendError(res, "admissionNo and dateOfBirth are required", 400);
      return;
    }

    const student = await findStudentByAdmissionAndDob(admissionNo, dateOfBirth);
    if (!student) {
      sendSuccess(res, { found: false }, "No matching student record found");
      return;
    }

    const exams = await prisma.exam.findMany({
      where: { classId: student.classId, isPublished: true },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, type: true, startDate: true, endDate: true },
    });

    const results = await Promise.all(
      exams.map(async (exam) => {
        const marks = await prisma.mark.findMany({
          where: { examId: exam.id, studentId: student.id },
          include: { subject: { select: { name: true, code: true } } },
          orderBy: { subject: { name: "asc" } },
        });
        const total = marks.reduce((sum, m) => sum + Number(m.obtainedMarks), 0);
        const maxTotal = marks.reduce((sum, m) => sum + Number(m.maxMarks), 0);
        return {
          examId: exam.id,
          examName: exam.name,
          examType: exam.type,
          subjects: marks.map((m) => ({ subject: m.subject.name, code: m.subject.code, obtained: m.obtainedMarks, max: m.maxMarks, grade: m.grade })),
          total,
          maxTotal,
          percentage: maxTotal > 0 ? Math.round((total / maxTotal) * 100) : 0,
        };
      })
    );

    sendSuccess(
      res,
      {
        found: true,
        studentName: student.user.name,
        admissionNo: student.admissionNo,
        className: student.class.name,
        sectionName: student.section.name,
        branchName: student.branch.name,
        results: results.filter((r) => r.subjects.length > 0),
      },
      "Results fetched"
    );
  } catch (error) {
    sendError(res, "Failed to fetch results", 500, (error as Error).message);
  }
};

/**
 * POST /api/public/fees/lookup
 * body: { admissionNo, dateOfBirth }
 * Returns an outstanding-dues SUMMARY only (per fee assignment: category,
 * pending amount, status) - not the full ledger/payment history, which
 * stays behind the authenticated parent/student portal.
 */
export const lookupPublicFeeStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { admissionNo, dateOfBirth } = req.body;
    if (!admissionNo || !dateOfBirth) {
      sendError(res, "admissionNo and dateOfBirth are required", 400);
      return;
    }

    const student = await findStudentByAdmissionAndDob(admissionNo, dateOfBirth);
    if (!student) {
      sendSuccess(res, { found: false }, "No matching student record found");
      return;
    }

    const assignments = await prisma.feeAssignment.findMany({
      where: { studentId: student.id, status: { in: ["PENDING", "PARTIAL", "OVERDUE"] } },
      include: { feeStructure: { include: { feeCategory: { select: { name: true } } } } },
      orderBy: { createdAt: "asc" },
    });

    const dues = assignments.map((a) => {
      const pending = Math.max(
        0,
        Number(a.totalAmount) - Number(a.paidAmount) - Number(a.discount) + Number(a.lateFee)
      );
      return {
        feeAssignmentId: a.id,
        category: a.feeStructure.feeCategory.name,
        totalAmount: a.totalAmount,
        paidAmount: a.paidAmount,
        pendingAmount: pending,
        status: a.status,
      };
    });

    const totalPending = dues.reduce((sum, d) => sum + d.pendingAmount, 0);

    sendSuccess(
      res,
      {
        found: true,
        studentName: student.user.name,
        admissionNo: student.admissionNo,
        className: student.class.name,
        sectionName: student.section.name,
        branchName: student.branch.name,
        totalPending,
        dues: dues.filter((d) => d.pendingAmount > 0),
      },
      "Fee status fetched"
    );
  } catch (error) {
    sendError(res, "Failed to fetch fee status", 500, (error as Error).message);
  }
};

/**
 * POST /api/public/fees/pay
 * body: { admissionNo, dateOfBirth, feeAssignmentId }
 * Public "Pay Now" hand-off - re-verifies admissionNo+dateOfBirth
 * (never trusts a bare feeAssignmentId from an anonymous caller
 * without re-confirming identity) then creates a Razorpay order via
 * the exact same getValidatedFeeAssignment + order-amount logic as
 * the authenticated createRazorpayOrder (payment.controller.ts) -
 * this is a separate controller function (not a reuse of that one)
 * because it has no req.user to derive branchId/studentId from; every
 * identity fact here comes from the request body, re-verified against
 * the DB.
 */
export const createPublicFeePaymentOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!isRazorpayConfigured()) {
      sendError(res, "Online payments are not configured on this server yet. Please contact the school office.", 503);
      return;
    }

    const { admissionNo, dateOfBirth, feeAssignmentId } = req.body;
    if (!admissionNo || !dateOfBirth || !feeAssignmentId) {
      sendError(res, "admissionNo, dateOfBirth, and feeAssignmentId are required", 400);
      return;
    }

    const student = await findStudentByAdmissionAndDob(admissionNo, dateOfBirth);
    if (!student) {
      sendError(res, "No matching student record found", 404);
      return;
    }

    const { assignment, error } = await getValidatedFeeAssignment(feeAssignmentId, student.id, student.branch.id);
    if (!assignment) {
      sendError(res, error || "Fee assignment not found", error?.includes("match") ? 400 : 404);
      return;
    }

    const pendingAmount =
      Number(assignment.totalAmount) - Number(assignment.paidAmount) - Number(assignment.discount) + Number(assignment.lateFee);
    if (pendingAmount <= 0) {
      sendError(res, "This fee has already been fully paid", 400);
      return;
    }

    const amountInPaise = Math.round(pendingAmount * 100);
    const razorpay = getRazorpayClient();
    const order = await razorpay.orders.create({
      amount: amountInPaise,
      currency: "INR",
      receipt: `pub_${feeAssignmentId}`.slice(0, 40),
      // No userId in notes (no authenticated caller) - the public
      // verify endpoint re-derives student/branch from
      // admissionNo+dateOfBirth again rather than trusting these notes
      // for anything security-relevant; they're purely informational.
      notes: { branchId: student.branch.id, studentId: student.id, feeAssignmentId, source: "PUBLIC_PORTAL" },
    });

    sendSuccess(
      res,
      { orderId: order.id, amount: order.amount, currency: order.currency, keyId: config.razorpay.keyId, studentId: student.id },
      "Order created"
    );
  } catch (error) {
    sendError(res, "Failed to create payment order", 500, (error as Error).message);
  }
};

/**
 * POST /api/public/fees/verify
 * body: { razorpay_order_id, razorpay_payment_id, razorpay_signature,
 *         admissionNo, dateOfBirth, feeAssignmentId }
 * Public counterpart to verifyRazorpayPayment (payment.controller.ts) -
 * same HMAC-signature verification and idempotency guard, re-deriving
 * student/branch from admissionNo+dateOfBirth instead of req.user.
 */
export const verifyPublicFeePayment = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!isRazorpayConfigured()) {
      sendError(res, "Online payments are not configured on this server", 503);
      return;
    }

    const {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature,
      admissionNo, dateOfBirth, feeAssignmentId,
    } = req.body;

    if (!admissionNo || !dateOfBirth || !feeAssignmentId || !orderId || !paymentId || !signature) {
      sendError(res, "Missing required fields", 400);
      return;
    }

    const student = await findStudentByAdmissionAndDob(admissionNo, dateOfBirth);
    if (!student) {
      sendError(res, "No matching student record found", 404);
      return;
    }

    const crypto = await import("crypto");
    const expectedSignature = crypto
      .createHmac("sha256", config.razorpay.keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");
    if (expectedSignature !== signature) {
      sendError(res, "Payment verification failed: signature mismatch", 400);
      return;
    }

    const existing = await prisma.payment.findFirst({ where: { transactionId: paymentId } });
    if (existing) {
      sendSuccess(res, { payment: existing }, "Payment already recorded");
      return;
    }

    const razorpay = getRazorpayClient();
    const rpPayment = await razorpay.payments.fetch(paymentId);
    if (rpPayment.status !== "captured" && rpPayment.status !== "authorized") {
      sendError(res, `Payment not completed (status: ${rpPayment.status})`, 400);
      return;
    }

    const { assignment, error } = await getValidatedFeeAssignment(feeAssignmentId, student.id, student.branch.id);
    if (!assignment) {
      sendError(res, error || "Fee assignment not found", 404);
      return;
    }

    const amount = Number(rpPayment.amount) / 100;

    const { recordFeePayment, notifyPaymentConfirmation } = await import("../services/feePayment.service");
    const result = await prisma.$transaction((tx) =>
      recordFeePayment(tx, assignment, {
        branchId: student.branch.id,
        studentId: student.id,
        feeAssignmentId,
        amount,
        paymentMode: "ONLINE_RAZORPAY",
        transactionId: paymentId,
        remarks: `Public portal - Razorpay order ${orderId}`,
      })
    );

    notifyPaymentConfirmation(student.id, student.user.name, amount, result.payment.receiptNo);

    sendSuccess(res, result, "Payment verified and recorded successfully", 201);
  } catch (error) {
    sendError(res, "Payment verification failed", 500, (error as Error).message);
  }
};

/**
 * GET /api/public/notices
 * Public notice board - only notices explicitly opted in via
 * `Notice.isPublic: true` and not yet expired.
 */
export const getPublicNotices = async (req: Request, res: Response): Promise<void> => {
  try {
    const branchId = req.query.branchId as string | undefined;
    const now = new Date();

    const notices = await prisma.notice.findMany({
      where: {
        isPublic: true,
        ...(branchId && { branchId }),
        OR: [{ expiryDate: null }, { expiryDate: { gte: now } }],
      },
      select: { id: true, title: true, body: true, attachmentUrl: true, isPinned: true, createdAt: true, branch: { select: { name: true } } },
      orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
      take: 50,
    });

    sendSuccess(res, notices, "Notices fetched");
  } catch (error) {
    sendError(res, "Failed to fetch notices", 500, (error as Error).message);
  }
};
