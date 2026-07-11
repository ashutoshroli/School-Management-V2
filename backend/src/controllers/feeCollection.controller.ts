import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError, sendPaginated } from "../utils/response";
import { canAccessBranch } from "../utils/branchScope";
import { canAccessStudentRecord } from "../utils/studentAccess";
import { getValidatedFeeAssignment, recordFeePayment, notifyPaymentConfirmation } from "../services/feePayment.service";
import { logAuditFromRequest } from "../services/auditLog.service";
import { sendFeeReminders } from "../services/feeReminder.service";
import { resolveBranchId } from "../utils/branchScope";

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
    if (!canAccessBranch(req, student.branchId) && !(await canAccessStudentRecord(req, studentId))) {
      sendError(res, "Student not found", 404);
      return;
    }

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

    const { assignment, error: assignmentError } = await getValidatedFeeAssignment(feeAssignmentId, studentId, branchId);
    if (!assignment) {
      sendError(res, assignmentError || "Fee assignment not found", assignmentError?.includes("match") ? 400 : 404);
      return;
    }

    // SAFETY: payment creation, fee assignment update, and the accounting
    // ledger post must all succeed or all roll back together - otherwise
    // we can end up with a recorded payment that has no matching ledger
    // entry (or vice versa), which is a real reconciliation risk for a
    // financial system.
    const { payment, lateFeeCharged, newStatus } = await prisma.$transaction((tx) =>
      recordFeePayment(tx, assignment, {
        branchId,
        studentId,
        feeAssignmentId,
        amount: Number(amount),
        paymentMode,
        transactionId,
        chequeNo,
        chequeDate: chequeDate ? new Date(chequeDate) : null,
        bankName,
        remarks,
        waiveLateFee,
      })
    );

    // Fire-and-forget - a slow/failed notification must never affect
    // the payment response.
    const student = await prisma.student.findUnique({ where: { id: studentId }, include: { user: { select: { name: true } } } });
    if (student) {
      notifyPaymentConfirmation(studentId, student.user.name, Number(amount), payment.receiptNo);
    }

    logAuditFromRequest(req, "CREATE", "payment", payment.id, { newData: payment });

    sendSuccess(res, { payment, lateFeeCharged, newStatus }, "Payment collected successfully", 201);
  } catch (error) {
    sendError(res, "Failed to collect payment", 500, (error as Error).message);
  }
};

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
    if (!canAccessBranch(req, student.branchId) && !(await canAccessStudentRecord(req, studentId))) {
      sendError(res, "Student not found", 404);
      return;
    }

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

    logAuditFromRequest(req, "CREATE", "refund", refund.id, { newData: refund, oldData: { payment } });

    sendSuccess(res, refund, "Refund processed", 201);
  } catch (error) {
    sendError(res, "Failed to process refund", 500, (error as Error).message);
  }
};

/**
 * POST /api/fees/reminders/send
 * Sends fee-payment reminders (Email + SMS) to every parent of every
 * student in the branch with a pending/partial/overdue fee assignment.
 * Triggerable on-demand by branch finance staff, or by an external
 * scheduler hitting this same endpoint on a cron (see
 * feeReminder.service.ts's header comment for why no in-process
 * scheduler is bundled).
 */
export const sendFeeRemindersHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    if (!branchId) {
      sendError(res, "Branch ID required", 400);
      return;
    }
    if (!canAccessBranch(req, branchId)) {
      sendError(res, "Access denied: branch mismatch", 403);
      return;
    }

    const result = await sendFeeReminders(branchId);

    logAuditFromRequest(req, "CREATE", "feeReminder", branchId, { newData: result });

    sendSuccess(res, result, `Reminders sent to ${result.notified} parent(s) across ${result.totalDefaulters} defaulting student(s)`);
  } catch (error) {
    sendError(res, "Failed to send fee reminders", 500, (error as Error).message);
  }
};
