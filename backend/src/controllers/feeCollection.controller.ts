import { Response } from "express";
import { Decimal } from "@prisma/client/runtime/library";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError, sendPaginated } from "../utils/response";

/**
 * Bulk assign fee structure to all students of a class
 */
export const bulkAssignFees = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { feeStructureId, classId, sectionId } = req.body;

    const structure = await prisma.feeStructure.findUnique({ where: { id: feeStructureId } });
    if (!structure) { sendError(res, "Fee structure not found", 404); return; }

    const where: any = { classId, isActive: true };
    if (sectionId) where.sectionId = sectionId;

    const students = await prisma.student.findMany({ where, select: { id: true } });

    let created = 0;
    let skipped = 0;

    for (const student of students) {
      const exists = await prisma.feeAssignment.findUnique({
        where: { studentId_feeStructureId: { studentId: student.id, feeStructureId } },
      });
      if (exists) { skipped++; continue; }

      await prisma.feeAssignment.create({
        data: {
          studentId: student.id,
          feeStructureId,
          totalAmount: structure.amount,
          paidAmount: 0,
          discount: 0,
          lateFee: 0,
          status: "PENDING",
        },
      });
      created++;
    }

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

    const assignment = await prisma.feeAssignment.findUnique({
      where: { id: feeAssignmentId },
      include: { feeStructure: true },
    });
    if (!assignment) { sendError(res, "Fee assignment not found", 404); return; }

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

    // Generate receipt number
    const count = await prisma.payment.count({ where: { branchId } });
    const receiptNo = `RCP-${String(count + 1).padStart(6, "0")}`;

    // Create payment
    const payment = await prisma.payment.create({
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

    // Update fee assignment
    const newPaid = Number(assignment.paidAmount) + amount;
    const newLateFee = Number(assignment.lateFee) + lateFeeCharged;
    const total = Number(assignment.totalAmount) - Number(assignment.discount) + newLateFee;
    const newStatus = newPaid >= total ? "PAID" : "PARTIAL";

    await prisma.feeAssignment.update({
      where: { id: feeAssignmentId },
      data: {
        paidAmount: newPaid,
        lateFee: newLateFee,
        status: newStatus,
      },
    });

    // Auto-post to accounting ledger
    try {
      await autoPostToAccounting(branchId, payment.id, amount, paymentMode, receiptNo);
    } catch (accErr) {
      console.error("Accounting auto-post failed:", accErr);
    }

    sendSuccess(res, { payment, lateFeeCharged, newStatus }, "Payment collected successfully", 201);
  } catch (error) {
    sendError(res, "Failed to collect payment", 500, (error as Error).message);
  }
};

/**
 * Auto-post fee payment to accounting ledger
 */
async function autoPostToAccounting(branchId: string, paymentId: string, amount: number, mode: string, receiptNo: string) {
  // Find Cash/Bank account and Fee Income account
  const cashAccount = await prisma.account.findFirst({
    where: { branchId, code: mode === "CASH" ? "1001" : "1002" },
  });
  const feeIncomeAccount = await prisma.account.findFirst({
    where: { branchId, code: "3001" },
  });

  if (!cashAccount || !feeIncomeAccount) return;

  // Generate voucher number
  const vCount = await prisma.voucher.count({ where: { branchId } });
  const voucherNo = `V-${String(vCount + 1).padStart(6, "0")}`;

  // Create receipt voucher
  const voucher = await prisma.voucher.create({
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
  await prisma.voucherEntry.create({
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

    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) { sendError(res, "Payment not found", 404); return; }
    if (Number(payment.amount) < amount) { sendError(res, "Refund amount cannot exceed payment amount", 400); return; }

    const refund = await prisma.refund.create({
      data: {
        paymentId,
        amount,
        reason,
        approvedBy: req.user!.userId,
      },
    });

    // Update payment status
    await prisma.payment.update({ where: { id: paymentId }, data: { status: "REFUNDED" } });

    // Update fee assignment
    const assignment = await prisma.feeAssignment.findUnique({ where: { id: payment.feeAssignmentId } });
    if (assignment) {
      const newPaid = Math.max(0, Number(assignment.paidAmount) - amount);
      await prisma.feeAssignment.update({
        where: { id: assignment.id },
        data: { paidAmount: newPaid, status: newPaid === 0 ? "PENDING" : "PARTIAL" },
      });
    }

    sendSuccess(res, refund, "Refund processed", 201);
  } catch (error) {
    sendError(res, "Failed to process refund", 500, (error as Error).message);
  }
};
