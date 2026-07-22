import { Prisma, PaymentMode, NotificationChannel } from "@prisma/client";
import prisma from "../config/database";

type FeeAssignmentWithStructure = Prisma.FeeAssignmentGetPayload<{
  include: { feeStructure: true; student: { select: { branchId: true } } };
}>;

/**
 * Fetch + validate a fee assignment belongs to the given student/branch.
 * Shared by the manual collection flow (feeCollection.controller.ts) and
 * the Razorpay online payment flow (payment.controller.ts) so both go
 * through identical validation.
 */
export const getValidatedFeeAssignment = async (
  feeAssignmentId: string,
  studentId: string,
  branchId: string
): Promise<{ assignment: FeeAssignmentWithStructure | null; error?: string }> => {
  const assignment = await prisma.feeAssignment.findUnique({
    where: { id: feeAssignmentId },
    include: { feeStructure: true, student: { select: { branchId: true } } },
  });

  if (!assignment) {
    return { assignment: null, error: "Fee assignment not found" };
  }

  if (assignment.studentId !== studentId || assignment.student.branchId !== branchId) {
    return { assignment: null, error: "Fee assignment does not match the given student/branch" };
  }

  return { assignment };
};

/**
 * Recomputes ONE FeeAssignment's `discount` column from the sum of its
 * currently-ACTIVE linked StudentDiscount rows, and writes it back.
 *
 * BUG FIX: assignDiscount/toggleDiscount/deleteDiscount used to only
 * ever touch the StudentDiscount table - nothing ever copied a
 * discount's value into FeeAssignment.discount, which is the column
 * getStudentPendingFees/recordFeePayment actually read to compute the
 * amount a student owes. A granted discount therefore never reduced
 * anything. Every discount mutation (create/toggle/delete) now calls
 * this for the discount's linked feeAssignmentId (a discount with no
 * feeAssignmentId - e.g. a legacy pre-migration row - has nothing to
 * recalculate and is skipped by callers before reaching here).
 *
 * A percentage discount is computed against the assignment's
 * totalAmount (not the already-discounted running total) - multiple
 * active percentage discounts on the same fee are additive percentages
 * of the original total, not compounded, which matches how a
 * "10% sibling + 5% merit" combo is normally described/expected.
 * capped at totalAmount so `discount` can never exceed what was
 * actually charged (an over-generous combination of discounts should
 * waive the fee entirely, not produce a negative pending amount).
 */
export const recalculateFeeAssignmentDiscount = async (
  tx: Prisma.TransactionClient | typeof prisma,
  feeAssignmentId: string
): Promise<void> => {
  const assignment = await tx.feeAssignment.findUnique({
    where: { id: feeAssignmentId },
    select: { totalAmount: true },
  });
  if (!assignment) return;

  // Sibling discount is NOT automatic - requires manual Principal
  // approval (spec Section 19). A SIBLING-type discount only
  // contributes to the total here once approvalStatus is APPROVED;
  // every other discount type defaults to APPROVED at creation
  // (unchanged prior behavior) so this filter is a no-op for them.
  const activeDiscounts = await tx.studentDiscount.findMany({
    where: { feeAssignmentId, isActive: true, approvalStatus: "APPROVED" },
    select: { value: true, isPercent: true },
  });

  const totalAmount = Number(assignment.totalAmount);
  const totalDiscount = activeDiscounts.reduce((sum, d) => {
    const contribution = d.isPercent ? (totalAmount * Number(d.value)) / 100 : Number(d.value);
    return sum + contribution;
  }, 0);

  await tx.feeAssignment.update({
    where: { id: feeAssignmentId },
    data: { discount: Math.min(totalDiscount, totalAmount) },
  });
};

/**
 * Fire-and-forget payment-confirmation notification to the student's
 * linked parents. Deliberately called AFTER the transaction commits
 * (not from inside recordFeePayment) - notification delivery is a side
 * effect that should never hold open a DB transaction or roll back a
 * successful payment if it fails.
 *
 * Sends via EMAIL (rich HTML receipt) and SMS - WhatsApp is
 * intentionally left out here since a payment confirmation is a
 * business-initiated message outside any customer session window, and
 * would need a pre-approved WhatsApp template
 * (see notification/whatsappProvider.ts's sendWhatsappTemplate) rather
 * than the free-text path.
 */
export const notifyPaymentConfirmation = async (
  studentId: string,
  studentName: string,
  amount: number,
  receiptNo: string
): Promise<void> => {
  // Lazy imports to avoid a circular dependency (notification.service.ts
  // doesn't depend on this file, but keeping the import local here
  // makes the dependency direction obvious at the call site).
  const { notifyParentsOfStudent } = await import("./notification.service");
  const { feePaymentReceiptEmail } = await import("./notification/emailTemplates");

  const title = "Fee Payment Received";
  const body = `We have received a payment of Rs ${amount.toLocaleString("en-IN")} for ${studentName}. Receipt No: ${receiptNo}.`;
  const emailTemplate = feePaymentReceiptEmail({ studentName, amount, receiptNo, paidAt: new Date() });

  await notifyParentsOfStudent(studentId, {
    type: "FEE_PAID",
    title,
    body,
    channels: [NotificationChannel.EMAIL, NotificationChannel.SMS],
    emailTemplate,
  }).catch((err) => console.error("Failed to send fee-payment notification:", err));
};

export interface RecordFeePaymentParams {
  branchId: string;
  studentId: string;
  feeAssignmentId: string;
  amount: number;
  paymentMode: PaymentMode;
  transactionId?: string;
  chequeNo?: string;
  chequeDate?: Date | null;
  bankName?: string;
  remarks?: string;
  waiveLateFee?: boolean;
}

/**
 * Core atomic fee-payment write: creates the Payment row, updates the
 * FeeAssignment totals/status, and auto-posts to the accounting ledger.
 * Must be called with a transaction client and an already-validated
 * `assignment` (see getValidatedFeeAssignment) so both the manual
 * collection endpoint and the Razorpay online-payment endpoints share
 * exactly one code path for this - no drift between the two flows.
 */
export const recordFeePayment = async (
  tx: Prisma.TransactionClient,
  assignment: FeeAssignmentWithStructure,
  params: RecordFeePaymentParams
) => {
  const { branchId, studentId, feeAssignmentId, amount, paymentMode, transactionId, chequeNo, chequeDate, bankName, remarks, waiveLateFee } = params;

  // Calculate late fee - 3-day grace period after the due date before
  // any late fee starts applying (spec Section 19), configurable PER
  // FEE CATEGORY via FeeCategory.lateFeeGraceDays (defaults to 3).
  // daysLate is counted from the END of the grace window, not from the
  // due date itself, so e.g. a 3-day grace + FIXED Rs 50/day type only
  // starts charging on day 4 after the due date, not day 1.
  let lateFeeCharged = 0;
  if (!waiveLateFee) {
    const struct = assignment.feeStructure;
    const now = new Date();
    if (struct.lateFeeType !== "NONE") {
      const category = await tx.feeCategory.findUnique({ where: { id: struct.feeCategoryId }, select: { lateFeeGraceDays: true } });
      const graceDays = category?.lateFeeGraceDays ?? 3;

      const dueDate = new Date(now.getFullYear(), now.getMonth(), struct.dueDay);
      const graceEndDate = new Date(dueDate);
      graceEndDate.setDate(graceEndDate.getDate() + graceDays);

      if (now > graceEndDate) {
        const daysLate = Math.floor((now.getTime() - graceEndDate.getTime()) / (1000 * 60 * 60 * 24));
        if (struct.lateFeeType === "FIXED") {
          lateFeeCharged = Number(struct.lateFeeValue) * daysLate;
        } else {
          const pending = Number(assignment.totalAmount) - Number(assignment.paidAmount) - Number(assignment.discount);
          lateFeeCharged = (pending * Number(struct.lateFeeValue)) / 100;
        }
      }
    }
  }

  const newPaid = Number(assignment.paidAmount) + Number(amount);
  const newLateFee = Number(assignment.lateFee) + lateFeeCharged;
  const total = Number(assignment.totalAmount) - Number(assignment.discount) + newLateFee;
  const newStatus = newPaid >= total ? "PAID" : "PARTIAL";

  // BUG FIX: Payment.receiptNo is globally unique (@unique, not
  // @@unique([branchId, ...])), but this used to generate it from a
  // branch-scoped count alone (e.g. "RCP-000001") - the first payment
  // collected in ANY second branch collided with the first branch's
  // "RCP-000001" and crashed with a Prisma unique-constraint violation.
  // Including the branch's own (globally unique) code makes this
  // string unique across branches too.
  const branch = await tx.branch.findUnique({ where: { id: branchId }, select: { code: true } });
  const count = await tx.payment.count({ where: { branchId } });
  const receiptNo = `RCP-${branch?.code || "STD"}-${String(count + 1).padStart(6, "0")}`;

  const payment = await tx.payment.create({
    data: {
      branchId,
      studentId,
      feeAssignmentId,
      amount,
      lateFeeCharged,
      paymentMode,
      transactionId,
      chequeNo,
      chequeDate: chequeDate || null,
      bankName,
      receiptNo,
      remarks,
      status: "SUCCESS",
      paidAt: new Date(),
    },
  });

  await tx.feeAssignment.update({
    where: { id: feeAssignmentId },
    data: {
      paidAmount: newPaid,
      lateFee: newLateFee,
      status: newStatus,
    },
  });

  await autoPostToAccounting(tx, branchId, payment.id, Number(amount), paymentMode, receiptNo);

  return { payment, lateFeeCharged, newStatus };
};

/**
 * Auto-post fee payment to accounting ledger.
 * Must be called with a transaction client (`tx`) so it is atomic with the
 * payment/fee-assignment writes above.
 */
export async function autoPostToAccounting(
  tx: Prisma.TransactionClient,
  branchId: string,
  paymentId: string,
  amount: number,
  mode: string,
  receiptNo: string
) {
  // Find Cash/Bank account and Fee Income account
  const cashAccount = await tx.account.findFirst({
    where: { branchId, code: mode === "CASH" ? "1001" : "1002" },
  });
  const feeIncomeAccount = await tx.account.findFirst({
    where: { branchId, code: "3001" },
  });

  if (!cashAccount || !feeIncomeAccount) {
    // No chart of accounts configured for this branch yet - fail loudly
    // (inside the transaction, so the payment itself rolls back too)
    // rather than silently skip the ledger post.
    throw new Error(
      `Accounting not configured for branch ${branchId}: missing Cash/Bank (1001/1002) or Fee Income (3001) account`
    );
  }

  // Generate voucher number
  const vCount = await tx.voucher.count({ where: { branchId } });
  const voucherNo = `V-${String(vCount + 1).padStart(6, "0")}`;

  // Create receipt voucher
  const voucher = await tx.voucher.create({
    data: {
      branchId,
      voucherNo,
      type: "RECEIPT",
      date: new Date(),
      narration: `Fee collection - Receipt ${receiptNo}`,
      paymentId,
      totalAmount: amount,
      isApproved: true,
    },
  });

  // Create voucher entry (Debit Cash/Bank, Credit Fee Income)
  await tx.voucherEntry.create({
    data: {
      voucherId: voucher.id,
      debitAccountId: cashAccount.id,
      creditAccountId: feeIncomeAccount.id,
      amount,
      narration: `Fee received - ${receiptNo}`,
    },
  });
}
