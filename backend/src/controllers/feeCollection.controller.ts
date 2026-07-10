import { Response } from "express";
import { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError, sendPaginated } from "../utils/response";
import { canAccessBranch } from "../utils/branchScope";

/**
 * Bulk assign fee structure to all students of a class
 */
export const bulkAssignFees = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { feeStructureId, classId, sectionId } = req.body;

    const structure = await prisma.feeStructure.findUnique({ where: { id: feeStructureId } });
    if (!structure) { sendError(res, "Fee structure not found", 404); return; }

    if (!canAccessBranch(req, structure.branchId)) {
      sendError(res, "Fee structure not found", 404);
      return;
    }

    const where: any = { classId, branchId: structure.branchId, isActive: true };
    if (sectionId) where.sectionId = sectionId;

    const students = await prisma.student.findMany({ where, select: { id: true } });

    // Find which of these students already have this fee structure
    // assigned in a single query instead of one findUnique per student
    // (N+1) - important since a class can have hundreds of students.
    const existingAssignments = await prisma.feeAssignment.findMany({
      where: { feeStructureId, studentId: { in: students.map((s) => s.id) } },
      select: { studentId: true },
    });
    const alreadyAssigned = new Set(existingAssignments.map((a) => a.studentId));

    const toCreate = students.filter((s) => !alreadyAssigned.has(s.id));

    if (toCreate.length > 0) {
      await prisma.feeAssignment.createMany({
        data: toCreate.map((student) => ({
          studentId: student.id,
          feeStructureId,
          totalAmount: structure.amount,
          paidAmount: 0,
          discount: 0,
          lateFee: 0,
          status: "PENDING" as const,
        })),
      });
    }

    const created = toCreate.length;
    const skipped = students.length - created;

    sendSuccess(res, { created, skipped, total: students.length }, `Fees assigned to ${created} students (${skipped} skipped - already assigned)`);
  } catch (error) {
    sendError(res, "Failed to assign fees", 500, (error as Error).message);
  }
};

/**
 * Get student's pending fees
 */
export const getStudentPendingFees = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { studentId } = req.params;

    const student = await prisma.student.findUnique({ where: { id: studentId }, select: { branchId: true } });
    if (!student) { sendError(res, "Student not found", 404); return; }
    if (!canAccessBranch(req, student.branchId)) { sendError(res, "Student not found", 404); return; }

    const assignments = await prisma.feeAssignment.findMany({
      where: { studentId, status: { in: ["PENDING", "PARTIAL", "OVERDUE"] } },
      include: {
        feeStructure: {
          include: {
            feeCategory: { select: { name: true, code: true } },
            class: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    // Calculate late fees
    const now = new Date();
    const enriched = assignments.map((a) => {
      let calculatedLateFee = 0;
      const struct = a.feeStructure;

      if (struct.lateFeeType !== "NONE") {
        const dueDate = new Date(now.getFullYear(), now.getMonth(), struct.dueDay);
        if (now > dueDate && a.status !== "PAID") {
          const daysLate = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
          if (struct.lateFeeType === "FIXED") {
            calculatedLateFee = Number(struct.lateFeeValue) * daysLate;
          } else if (struct.lateFeeType === "PERCENTAGE") {
            const pending = Number(a.totalAmount) - Number(a.paidAmount) - Number(a.discount);
            calculatedLateFee = (pending * Number(struct.lateFeeValue)) / 100;
          }
        }
      }

      const pendingAmount = Number(a.totalAmount) - Number(a.paidAmount) - Number(a.discount) + calculatedLateFee;

      return {
        ...a,
        calculatedLateFee,
        pendingAmount: Math.max(0, pendingAmount),
      };
    });

    sendSuccess(res, enriched, "Pending fees fetched");
  } catch (error) {
    sendError(res, "Failed to fetch pending fees", 500, (error as Error).message);
  }
};

/**
 * Collect fee payment
 */
export const collectPayment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      branchId, studentId, feeAssignmentId, amount,
      paymentMode, transactionId, chequeNo, chequeDate, bankName, remarks,
      waiveLateFee, // if true, admin waives late fee
    } = req.body;

    if (!canAccessBranch(req, branchId)) {
      sendError(res, "Access denied: branch mismatch", 403);
      return;
    }

    if (!amount || Number(amount) <= 0) {
      sendError(res, "Payment amount must be greater than zero", 400);
      return;
    }

    const assignment = await prisma.feeAssignment.findUnique({
      where: { id: feeAssignmentId },
      include: { feeStructure: true, student: { select: { branchId: true } } },
    });
    if (!assignment) { sendError(res, "Fee assignment not found", 404); return; }

    // Make sure the fee assignment actually belongs to the branch/student passed in.
    if (assignment.studentId !== studentId || assignment.student.branchId !== branchId) {
      sendError(res, "Fee assignment does not match the given student/branch", 400);
      return;
    }

    // Calculate late fee
    let lateFeeCharged = 0;
    if (!waiveLateFee) {
      const struct = assignment.feeStructure;
      const now = new Date();
      if (struct.lateFeeType !== "NONE") {
        const dueDate = new Date(now.getFullYear(), now.getMonth(), struct.dueDay);
        if (now > dueDate) {
          const daysLate = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
          if (struct.lateFeeType === "FIXED") {
            lateFeeCharged = Number(struct.lateFeeValue) * daysLate;
          } else {
            const pending = Number(assignment.totalAmount) - Number(assignment.paidAmount) - Number(assignment.discount);
            lateFeeCharged = (pending * Number(struct.lateFeeValue)) / 100;
          }
        }
      }
    }

    // Update fee assignment totals
    const newPaid = Number(assignment.paidAmount) + Number(amount);
    const newLateFee = Number(assignment.lateFee) + lateFeeCharged;
    const total = Number(assignment.totalAmount) - Number(assignment.discount) + newLateFee;
    const newStatus = newPaid >= total ? "PAID" : "PARTIAL";

    // SAFETY: payment creation, fee assignment update, and the accounting
    // ledger post must all succeed or all roll back together - otherwise
    // we can end up with a recorded payment that has no matching ledger
    // entry (or vice versa), which is a real reconciliation risk for a
    // financial system.
    const { payment } = await prisma.$transaction(async (tx) => {
      // Generate receipt number inside the transaction to reduce (but not
      // fully eliminate, without a DB sequence) the race window under
      // concurrent collections for the same branch.
      const count = await tx.payment.count({ where: { branchId } });
      const receiptNo = `RCP-${String(count + 1).padStart(6, "0")}`;

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
          chequeDate: chequeDate ? new Date(chequeDate) : null,
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

      return { payment };
    });

    sendSuccess(res, { payment, lateFeeCharged, newStatus }, "Payment collected successfully", 201);
  } catch (error) {
    sendError(res, "Failed to collect payment", 500, (error as Error).message);
  }
};

/**
 * Auto-post fee payment to accounting ledger.
 * Must be called with a transaction client (`tx`) so it is atomic with the
 * payment/fee-assignment writes in `collectPayment`.
 */
async function autoPostToAccounting(
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
    // No chart of accounts configured for this branch yet - skip the
    // ledger post rather than failing the whole payment. Surface this so
    // ops can fix the missing accounts.
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

/**
 * Get payment history for a student
 */
export const getStudentPayments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { studentId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const student = await prisma.student.findUnique({ where: { id: studentId }, select: { branchId: true } });
    if (!student) { sendError(res, "Student not found", 404); return; }
    if (!canAccessBranch(req, student.branchId)) { sendError(res, "Student not found", 404); return; }

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where: { studentId },
        skip,
        take: limit,
        orderBy: { paidAt: "desc" },
        include: {
          feeAssignment: {
            include: { feeStructure: { include: { feeCategory: { select: { name: true } } } } },
          },
        },
      }),
      prisma.payment.count({ where: { studentId } }),
    ]);

    sendPaginated(res, payments, total, page, limit, "Payments fetched");
  } catch (error) {
    sendError(res, "Failed to fetch payments", 500, (error as Error).message);
  }
};

/**
 * Waive/Override late fee for a student's fee assignment
 */
export const waiveLateFee = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params; // feeAssignmentId
    const { lateFee } = req.body; // new late fee amount (0 = full waive)

    const assignment = await prisma.feeAssignment.findUnique({
      where: { id },
      include: { student: { select: { branchId: true } } },
    });
    if (!assignment) { sendError(res, "Fee assignment not found", 404); return; }
    if (!canAccessBranch(req, assignment.student.branchId)) { sendError(res, "Fee assignment not found", 404); return; }

    const updated = await prisma.feeAssignment.update({
      where: { id },
      data: { lateFee: lateFee || 0 },
    });

    sendSuccess(res, updated, "Late fee updated");
  } catch (error) {
    sendError(res, "Failed to waive late fee", 500, (error as Error).message);
  }
};

/**
 * Create refund
 */
export const createRefund = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { paymentId, amount, reason } = req.body;

    if (!amount || Number(amount) <= 0) {
      sendError(res, "Refund amount must be greater than zero", 400);
      return;
    }

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { student: { select: { branchId: true } } },
    });
    if (!payment) { sendError(res, "Payment not found", 404); return; }

    if (!canAccessBranch(req, payment.branchId)) {
      sendError(res, "Payment not found", 404);
      return;
    }
    if (payment.status === "REFUNDED") { sendError(res, "Payment has already been refunded", 400); return; }
    if (Number(payment.amount) < Number(amount)) { sendError(res, "Refund amount cannot exceed payment amount", 400); return; }

    const refund = await prisma.$transaction(async (tx) => {
      const refund = await tx.refund.create({
        data: {
          paymentId,
          amount,
          reason,
          approvedBy: req.user!.userId,
        },
      });

      await tx.payment.update({ where: { id: paymentId }, data: { status: "REFUNDED" } });

      const assignment = await tx.feeAssignment.findUnique({ where: { id: payment.feeAssignmentId } });
      if (assignment) {
        const newPaid = Math.max(0, Number(assignment.paidAmount) - Number(amount));
        await tx.feeAssignment.update({
          where: { id: assignment.id },
          data: { paidAmount: newPaid, status: newPaid === 0 ? "PENDING" : "PARTIAL" },
        });
      }

      return refund;
    });

    sendSuccess(res, refund, "Refund processed", 201);
  } catch (error) {
    sendError(res, "Failed to process refund", 500, (error as Error).message);
  }
};
