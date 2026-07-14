import { Request, Response } from "express";
import crypto from "crypto";
import prisma from "../config/database";
import { config } from "../config";
import { logger, logError } from "../config/logger";
import { getRazorpayClient, isRazorpayConfigured } from "../config/razorpay";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { canAccessBranch, resolveEffectiveBranchId } from "../utils/branchScope";
import { canAccessStudentRecord } from "../utils/studentAccess";
import { getValidatedFeeAssignment, recordFeePayment, notifyPaymentConfirmation } from "../services/feePayment.service";

/**
 * Step 1 of the online payment flow: create a Razorpay order for a given
 * fee assignment. No Payment row is created yet - that only happens
 * once we've verified the payment actually succeeded (see
 * verifyRazorpayPayment / razorpayWebhook below). This avoids ever
 * recording a "successful" payment that the gateway hasn't confirmed.
 */
export const createRazorpayOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!isRazorpayConfigured()) {
      sendError(res, "Online payments are not configured on this server yet. Please contact the school office.", 503);
      return;
    }

    const { studentId, feeAssignmentId } = req.body;
    // DEFENSE IN DEPTH: same fallback as the other create/collect
    // endpoints - branchId here normally comes from the student's own
    // record (see frontend/src/lib/razorpay.ts), not a blank form
    // field, but falling back to the caller's own branch if it's ever
    // missing/blank keeps this consistent and avoids a confusing 403.
    const branchId = resolveEffectiveBranchId(req, req.body.branchId);

    if (!branchId) {
      sendError(res, "Branch ID could not be resolved", 400);
      return;
    }
    if (!canAccessBranch(req, branchId)) {
      sendError(res, "Access denied: branch mismatch", 403);
      return;
    }

    // SECURITY: this endpoint is reachable by STUDENT/PARENT roles (they
    // need to be able to pay fees online) - make sure they're only
    // paying for their own record / their own child, not an arbitrary
    // studentId (IDOR).
    if (!(await canAccessStudentRecord(req, studentId))) {
      sendError(res, "You do not have access to this student's fees", 403);
      return;
    }

    const { assignment, error } = await getValidatedFeeAssignment(feeAssignmentId, studentId, branchId);
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

    // Razorpay amounts are in the smallest currency unit (paise for INR).
    const amountInPaise = Math.round(pendingAmount * 100);

    const razorpay = getRazorpayClient();
    const order = await razorpay.orders.create({
      amount: amountInPaise,
      currency: "INR",
      receipt: `fa_${feeAssignmentId}`.slice(0, 40),
      notes: { branchId, studentId, feeAssignmentId, userId: req.user!.userId },
    });

    sendSuccess(res, {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: config.razorpay.keyId,
    }, "Order created");
  } catch (error) {
    sendError(res, "Failed to create payment order", 500, (error as Error).message);
  }
};

/**
 * Step 2 (client-redirect path): the frontend calls this right after
 * Razorpay's checkout succeeds, passing back order/payment/signature. We
 * independently verify the HMAC signature server-side before recording
 * anything - never trust amount/status coming from the browser alone.
 *
 * Note: the webhook handler below is the more reliable confirmation path
 * (it fires even if the user closes the browser tab after paying), so
 * this endpoint is idempotent - if the webhook already recorded the
 * payment for this order, this just returns the existing record.
 */
export const verifyRazorpayPayment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!isRazorpayConfigured()) {
      sendError(res, "Online payments are not configured on this server", 503);
      return;
    }

    const {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature,
      studentId, feeAssignmentId,
    } = req.body;
    const branchId = resolveEffectiveBranchId(req, req.body.branchId);

    if (!branchId) {
      sendError(res, "Branch ID could not be resolved", 400);
      return;
    }
    if (!canAccessBranch(req, branchId)) {
      sendError(res, "Access denied: branch mismatch", 403);
      return;
    }

    if (!(await canAccessStudentRecord(req, studentId))) {
      sendError(res, "You do not have access to this student's fees", 403);
      return;
    }

    const expectedSignature = crypto
      .createHmac("sha256", config.razorpay.keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    if (expectedSignature !== signature) {
      sendError(res, "Payment verification failed: signature mismatch", 400);
      return;
    }

    // Idempotency: if this order/payment was already recorded (e.g. by
    // the webhook firing first), don't double-record it.
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

    const { assignment, error } = await getValidatedFeeAssignment(feeAssignmentId, studentId, branchId);
    if (!assignment) {
      sendError(res, error || "Fee assignment not found", 404);
      return;
    }

    const amount = Number(rpPayment.amount) / 100; // paise -> rupees

    const result = await prisma.$transaction((tx) =>
      recordFeePayment(tx, assignment, {
        branchId,
        studentId,
        feeAssignmentId,
        amount,
        paymentMode: "ONLINE_RAZORPAY",
        transactionId: paymentId,
        remarks: `Razorpay order ${orderId}`,
      })
    );

    const studentRecord = await prisma.student.findUnique({ where: { id: studentId }, include: { user: { select: { name: true } } } });
    if (studentRecord) {
      notifyPaymentConfirmation(studentId, studentRecord.user.name, amount, result.payment.receiptNo);
    }

    sendSuccess(res, result, "Payment verified and recorded successfully", 201);
  } catch (error) {
    sendError(res, "Payment verification failed", 500, (error as Error).message);
  }
};

/**
 * Shared handler for any webhook event whose payload carries a captured/
 * successful `payment.entity` - both `payment.captured` and `order.paid`
 * include one (per Razorpay's webhook payload reference), so this is
 * called from both instead of duplicating the recording logic.
 *
 * Idempotent by design: webhooks can be retried/duplicated by Razorpay,
 * AND `order.paid` fires for the same underlying payment that already
 * triggered `payment.captured` (or vice versa, ordering isn't
 * guaranteed) - the transactionId uniqueness check below means whichever
 * event arrives second is a no-op.
 */
const handleCapturedPayment = async (rpPayment: any): Promise<void> => {
  const paymentId = rpPayment.id as string;
  const notes = rpPayment.notes || {};
  const { branchId, studentId, feeAssignmentId } = notes;

  const existing = await prisma.payment.findFirst({ where: { transactionId: paymentId } });
  if (existing) return;

  if (!branchId || !studentId || !feeAssignmentId) return;

  const { assignment } = await getValidatedFeeAssignment(feeAssignmentId, studentId, branchId);
  if (!assignment) return;

  const amount = Number(rpPayment.amount) / 100;
  const result = await prisma.$transaction((tx) =>
    recordFeePayment(tx, assignment, {
      branchId,
      studentId,
      feeAssignmentId,
      amount,
      paymentMode: "ONLINE_RAZORPAY",
      transactionId: paymentId,
      remarks: `Razorpay webhook - order ${rpPayment.order_id}`,
    })
  );

  const studentRecord = await prisma.student.findUnique({ where: { id: studentId }, include: { user: { select: { name: true } } } });
  if (studentRecord) {
    notifyPaymentConfirmation(studentId, studentRecord.user.name, amount, result.payment.receiptNo);
  }
};

/**
 * Handler for `payment.failed` - no fee is actually paid here (the
 * FeeAssignment/accounting ledger are deliberately left untouched), but
 * we still record a lightweight FAILED Payment row for visibility/
 * audit ("why does this student's dashboard show a failed attempt but
 * no receipt"). Every fee-reports query (day book, collection trend,
 * defaulters, etc - see feeReports.controller.ts) explicitly filters
 * `status: "SUCCESS"`, so a FAILED row here can never inflate revenue
 * totals or otherwise corrupt those reports.
 */
const handleFailedPayment = async (rpPayment: any): Promise<void> => {
  const paymentId = rpPayment.id as string;
  const notes = rpPayment.notes || {};
  const { branchId, studentId, feeAssignmentId } = notes;

  const existing = await prisma.payment.findFirst({ where: { transactionId: paymentId } });
  if (existing) return;

  if (!branchId || !studentId || !feeAssignmentId) {
    logger.warn("Razorpay payment.failed webhook missing branchId/studentId/feeAssignmentId notes", { paymentId });
    return;
  }

  const { assignment } = await getValidatedFeeAssignment(feeAssignmentId, studentId, branchId);
  if (!assignment) return;

  const amount = Number(rpPayment.amount) / 100;
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { code: true } });
  const count = await prisma.payment.count({ where: { branchId } });
  const receiptNo = `RCP-${branch?.code || "STD"}-${String(count + 1).padStart(6, "0")}`;

  await prisma.payment.create({
    data: {
      branchId,
      studentId,
      feeAssignmentId,
      amount,
      paymentMode: "ONLINE_RAZORPAY",
      transactionId: paymentId,
      receiptNo,
      remarks: `Razorpay payment failed: ${rpPayment.error_description || rpPayment.error_code || "unknown reason"}`,
      status: "FAILED",
    },
  });

  logger.warn("Razorpay payment.failed", {
    paymentId,
    branchId,
    studentId,
    feeAssignmentId,
    errorCode: rpPayment.error_code,
    errorDescription: rpPayment.error_description,
  });
};

/**
 * Razorpay webhook - server-to-server confirmation of payment events.
 * This is the authoritative confirmation path (independent of whether
 * the paying user's browser stayed open) and should be configured in
 * the Razorpay dashboard to point at POST /api/fees/razorpay/webhook.
 *
 * Requires RAZORPAY_WEBHOOK_SECRET to be set - without it we cannot
 * verify the request actually came from Razorpay, so we refuse to
 * process events (fail closed, not open).
 */
export const razorpayWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!config.razorpay.webhookSecret) {
      // Fail closed: we cannot verify authenticity without a webhook
      // secret, so do not process the event.
      res.status(503).json({ success: false, message: "Webhook not configured" });
      return;
    }

    const signature = req.headers["x-razorpay-signature"] as string | undefined;
    const rawBody = req.rawBody;
    if (!signature || !rawBody) {
      res.status(400).json({ success: false, message: "Missing signature or body" });
      return;
    }

    const expected = crypto
      .createHmac("sha256", config.razorpay.webhookSecret)
      .update(rawBody)
      .digest("hex");

    if (expected !== signature) {
      res.status(400).json({ success: false, message: "Invalid signature" });
      return;
    }

    const event = req.body;

    switch (event.event) {
      case "payment.captured":
      case "order.paid": {
        // Both event payloads carry a payment.entity (order.paid's is
        // the payment that completed the order) - see
        // handleCapturedPayment's doc comment for why one shared
        // handler is safe/idempotent for both.
        const rpPayment = event.payload?.payment?.entity;
        if (rpPayment) {
          await handleCapturedPayment(rpPayment);
        }
        break;
      }
      case "payment.failed": {
        const rpPayment = event.payload?.payment?.entity;
        if (rpPayment) {
          await handleFailedPayment(rpPayment);
        }
        break;
      }
      default:
        // Any other event type is intentionally ignored - still 200'd
        // below so Razorpay doesn't keep retrying it.
        break;
    }

    // Always 200 quickly so Razorpay doesn't keep retrying an event we
    // successfully received, even if we chose not to act on it above.
    res.status(200).json({ success: true, message: "Webhook processed" });
  } catch (error) {
    logError("Razorpay webhook error", error);
    // Still ack with 200 to avoid endless gateway retries for an event
    // that has a permanent (non-transient) processing issue on our side;
    // the error is logged server-side for investigation.
    res.status(200).json({ success: false, message: "Webhook received but processing failed" });
  }
};
