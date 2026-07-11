import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError, sendPaginated } from "../utils/response";
import { canAccessBranch, resolveEffectiveBranchId } from "../utils/branchScope";
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
 * Assign a fee structure to a specific, hand-picked list of students -
 * the counterpart to bulkAssignFees above (which targets an entire
 * class/section). Used when a fee only applies to certain students
 * rather than everyone in a class (e.g. a one-off lab fee for students
 * who opted into a subject, or a hostel fee for students who transferred
 * in mid-year and shouldn't get the whole-class assignment).
 */
export const assignFeesToStudents = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { feeStructureId, studentIds } = req.body;

    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      sendError(res, "studentIds must be a non-empty array", 400);
      return;
    }

    const structure = await prisma.feeStructure.findUnique({ where: { id: feeStructureId } });
    if (!structure) { sendError(res, "Fee structure not found", 404); return; }

    if (!canAccessBranch(req, structure.branchId)) {
      sendError(res, "Fee structure not found", 404);
      return;
    }

    // Look up all requested students in one query - both to validate
    // they exist and to enforce that every one of them actually
    // belongs to the fee structure's branch (a Branch Admin could
    // otherwise smuggle in a studentId from another branch).
    const students = await prisma.student.findMany({
      where: { id: { in: studentIds } },
      select: { id: true, branchId: true },
    });

    const foundIds = new Set(students.map((s) => s.id));
    const notFound = studentIds.filter((id: string) => !foundIds.has(id));
    if (notFound.length > 0) {
      sendError(res, `${notFound.length} student(s) in this list were not found`, 404);
      return;
    }
    const outOfBranch = students.some((s) => s.branchId !== structure.branchId);
    if (outOfBranch) {
      sendError(res, "One or more students do not belong to this fee structure's branch", 403);
      return;
    }

    // Same N+1-avoidance pattern as bulkAssignFees: one query to find
    // who already has this assignment, instead of a findUnique-per-student.
    const existingAssignments = await prisma.feeAssignment.findMany({
      where: { feeStructureId, studentId: { in: studentIds } },
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

    sendSuccess(res, { created, skipped, total: students.length }, `Fees assigned to ${created} student(s) (${skipped} skipped - already assigned)`);
  } catch (error) {
    sendError(res, "Failed to assign fees", 500, (error as Error).message);
  }
};

/**
 * Assign a transport fee to every student currently allocated to a
 * transport route - the transport counterpart to bulkAssignFees
 * (class-wise) and assignFeesToStudents (hand-picked list) above.
 *
 * Unlike those two, this doesn't require a FeeStructure to already
 * exist: it finds-or-creates one automatically, keyed on
 * (branch, academicYear, route, feeCategory) via the
 * @@unique([branchId, academicYearId, transportRouteId, feeCategoryId])
 * constraint on FeeStructure - so calling this endpoint twice for the
 * same route/year reuses the same structure instead of creating
 * duplicates (mirrors the "Transport Fee" system FeeCategory seeded in
 * db/prisma/seed.ts, auto-created here too if a branch doesn't have it
 * yet - e.g. any branch created after that seed script ran).
 *
 * FeeStructure.classId is intentionally left null for these - a
 * transport fee applies to whichever students are allocated to the
 * route, which cuts across classes, not to a specific class.
 */
export const assignTransportFee = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { routeId, academicYearId } = req.body;

    if (!routeId) { sendError(res, "routeId is required", 400); return; }
    if (!academicYearId) { sendError(res, "academicYearId is required", 400); return; }

    const route = await prisma.transportRoute.findUnique({ where: { id: routeId } });
    if (!route) { sendError(res, "Transport route not found", 404); return; }
    if (!canAccessBranch(req, route.branchId)) { sendError(res, "Transport route not found", 404); return; }

    const academicYear = await prisma.academicYear.findUnique({ where: { id: academicYearId } });
    if (!academicYear || academicYear.branchId !== route.branchId) {
      sendError(res, "Academic year not found for this branch", 404);
      return;
    }

    // Find-or-create the branch's "Transport Fee" system category -
    // present via db/prisma/seed.ts's demo data, but a branch created
    // through the running app (see createBranch's own auto-seeding of
    // Chart of Accounts for the same class of issue) has no fee
    // categories at all until an admin creates them, so this can't
    // assume it already exists.
    let transportCategory = await prisma.feeCategory.findUnique({
      where: { branchId_code: { branchId: route.branchId, code: "TRANSPORT" } },
    });
    if (!transportCategory) {
      transportCategory = await prisma.feeCategory.create({
        data: { branchId: route.branchId, name: "Transport Fee", code: "TRANSPORT", isSystem: true, isActive: true },
      });
    }

    // Find-or-create the route's FeeStructure for this academic year.
    // NOTE: if the route's monthlyFee has changed since this structure
    // was first created, the structure amount is NOT retroactively
    // updated here (same as class-wise structures, which also don't
    // auto-track changes elsewhere) - edit the fee structure directly
    // (Fees > Fee Structures) if the amount needs correcting.
    let structure = await prisma.feeStructure.findUnique({
      where: {
        branchId_academicYearId_transportRouteId_feeCategoryId: {
          branchId: route.branchId,
          academicYearId,
          transportRouteId: routeId,
          feeCategoryId: transportCategory.id,
        },
      },
    });
    if (!structure) {
      structure = await prisma.feeStructure.create({
        data: {
          branchId: route.branchId,
          academicYearId,
          transportRouteId: routeId,
          feeCategoryId: transportCategory.id,
          amount: route.monthlyFee,
          frequency: "MONTHLY",
          dueDay: 10,
          lateFeeType: "NONE",
          lateFeeValue: 0,
          isActive: true,
        },
      });
    }

    const allocations = await prisma.transportAllocation.findMany({
      where: { routeId },
      select: { studentId: true },
    });

    if (allocations.length === 0) {
      sendSuccess(res, { created: 0, skipped: 0, total: 0 }, "No students are currently allocated to this route");
      return;
    }

    // Same N+1-avoidance pattern as bulkAssignFees/assignFeesToStudents:
    // one query to find who already has this assignment, instead of a
    // findUnique-per-student.
    const existingAssignments = await prisma.feeAssignment.findMany({
      where: { feeStructureId: structure.id, studentId: { in: allocations.map((a) => a.studentId) } },
      select: { studentId: true },
    });
    const alreadyAssigned = new Set(existingAssignments.map((a) => a.studentId));

    const toCreate = allocations.filter((a) => !alreadyAssigned.has(a.studentId));

    if (toCreate.length > 0) {
      await prisma.feeAssignment.createMany({
        data: toCreate.map((a) => ({
          studentId: a.studentId,
          feeStructureId: structure!.id,
          totalAmount: structure!.amount,
          paidAmount: 0,
          discount: 0,
          lateFee: 0,
          status: "PENDING" as const,
        })),
      });
    }

    const created = toCreate.length;
    const skipped = allocations.length - created;

    sendSuccess(
      res,
      { created, skipped, total: allocations.length, feeStructureId: structure.id },
      `Transport fee assigned to ${created} student(s) (${skipped} skipped - already assigned)`
    );
  } catch (error) {
    sendError(res, "Failed to assign transport fee", 500, (error as Error).message);
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
            // Present instead of `class` for transport fees (see the
            // FeeStructure model's doc comment in schema.prisma) - the
            // frontend falls back to this when `class` is null.
            transportRoute: { select: { name: true } },
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
      studentId, feeAssignmentId, amount,
      paymentMode, transactionId, chequeNo, chequeDate, bankName, remarks,
      waiveLateFee, // if true, admin waives late fee
    } = req.body;
    // DEFENSE IN DEPTH: this endpoint's branchId normally comes from a
    // real student record's branchId (frontend/dashboard/fees/collect
    // sets it from the already-fetched selectedStudent), not a blank
    // form field like the other endpoints fixed alongside this one -
    // but falling back the same way if it's ever missing/blank costs
    // nothing and keeps this endpoint consistent with the rest.
    const branchId = resolveEffectiveBranchId(req, req.body.branchId);

    if (!branchId) {
      sendError(res, "Branch ID could not be resolved - please select a branch", 400);
      return;
    }
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
