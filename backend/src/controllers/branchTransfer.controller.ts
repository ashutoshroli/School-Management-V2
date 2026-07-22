import { Response } from "express";
import { UserRole } from "@prisma/client";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { canAccessBranch } from "../utils/branchScope";

/**
 * Branch Transfer module (spec Section 5) - students & staff.
 *
 * Two initiation paths:
 *  - Director (BRANCH_ADMIN/SUPER_ADMIN) transfers directly - no
 *    approval needed, the transfer record is created already APPROVED.
 *  - Principal-initiated - origin Principal sends a transfer request;
 *    the DESTINATION Principal must approve/reject it.
 *
 * completeStudentTransfer/completeStaffTransfer actually move the
 * record to the new branch once APPROVED (kept as a separate explicit
 * step rather than folding into the approval itself, since the fee
 * dues 3-option decision for students needs to be made at/around this
 * point too - see the spec's flow).
 */

const isDirectorRole = (role?: UserRole) => role === UserRole.BRANCH_ADMIN || role === UserRole.SUPER_ADMIN;
const isPrincipalRole = (role?: UserRole) => role === UserRole.PRINCIPAL || role === UserRole.VICE_PRINCIPAL;

// ===================== STUDENT TRANSFER =====================

export const initiateStudentTransfer = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { studentId, destinationBranchId } = req.body;

    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student) { sendError(res, "Student not found", 404); return; }
    if (!canAccessBranch(req, student.branchId)) { sendError(res, "Student not found", 404); return; }

    const destinationBranch = await prisma.branch.findUnique({ where: { id: destinationBranchId } });
    if (!destinationBranch) { sendError(res, "Destination branch not found", 404); return; }
    if (destinationBranchId === student.branchId) { sendError(res, "Destination branch must be different from the origin branch", 400); return; }

    const role = req.user!.role;
    const isDirector = isDirectorRole(role);
    const isPrincipal = isPrincipalRole(role);
    if (!isDirector && !isPrincipal) {
      sendError(res, "Only a Director or Principal can initiate a student transfer", 403);
      return;
    }

    // Outstanding dues at origin, computed once at initiation so the
    // destination Principal's fee-dues decision (see
    // decideStudentTransferFeeDues below) has a fixed reference amount.
    const pendingAssignments = await prisma.feeAssignment.findMany({
      where: { studentId, status: { in: ["PENDING", "PARTIAL", "OVERDUE"] } },
    });
    const outstandingDues = pendingAssignments.reduce(
      (sum, a) => sum + (Number(a.totalAmount) - Number(a.paidAmount) - Number(a.discount) + Number(a.lateFee)),
      0
    );

    const transfer = await prisma.studentBranchTransfer.create({
      data: {
        studentId,
        originBranchId: student.branchId,
        destinationBranchId,
        initiatedBy: req.user!.userId,
        initiatedByRole: isDirector ? "DIRECTOR" : "ORIGIN_PRINCIPAL",
        // Director transfers directly - no approval needed (spec).
        status: isDirector ? "APPROVED" : "PENDING",
        outstandingDuesAtOrigin: outstandingDues > 0 ? outstandingDues : null,
        ...(isDirector && { destinationApprovedBy: req.user!.userId, destinationApprovedAt: new Date() }),
      },
    });

    sendSuccess(res, transfer, isDirector ? "Transfer initiated and auto-approved (Director)" : "Transfer request sent to destination Principal", 201);
  } catch (error) {
    sendError(res, "Failed to initiate student transfer", 500, (error as Error).message);
  }
};

/**
 * Destination Principal approves/rejects a Principal-initiated
 * transfer request.
 */
export const respondToStudentTransfer = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { decision, rejectionReason } = req.body; // "APPROVE" | "REJECT"

    const transfer = await prisma.studentBranchTransfer.findUnique({ where: { id } });
    if (!transfer) { sendError(res, "Transfer request not found", 404); return; }
    if (!canAccessBranch(req, transfer.destinationBranchId)) { sendError(res, "Transfer request not found", 404); return; }
    if (transfer.status !== "PENDING") { sendError(res, "This request has already been decided", 400); return; }

    const updated = await prisma.studentBranchTransfer.update({
      where: { id },
      data: {
        status: decision === "APPROVE" ? "APPROVED" : "REJECTED",
        destinationApprovedBy: req.user!.userId,
        destinationApprovedAt: new Date(),
        ...(decision === "REJECT" && { rejectionReason }),
      },
    });

    sendSuccess(res, updated, `Transfer ${decision === "APPROVE" ? "approved" : "rejected"}`);
  } catch (error) {
    sendError(res, "Failed to respond to transfer request", 500, (error as Error).message);
  }
};

/**
 * Destination Principal's fee-dues decision (spec Section 5 - 3
 * options), recorded before completion. Only meaningful/callable when
 * outstandingDuesAtOrigin > 0.
 */
export const decideStudentTransferFeeDues = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { feeDuesOption } = req.body; // CARRY_FORWARD | CLEAR_DUES_AND_ADMIT | CLEAR_AT_OLD_BRANCH

    const transfer = await prisma.studentBranchTransfer.findUnique({ where: { id } });
    if (!transfer) { sendError(res, "Transfer not found", 404); return; }
    if (!canAccessBranch(req, transfer.destinationBranchId)) { sendError(res, "Transfer not found", 404); return; }
    if (transfer.status !== "APPROVED") { sendError(res, "Transfer must be approved before deciding fee dues", 400); return; }
    if (!transfer.outstandingDuesAtOrigin || Number(transfer.outstandingDuesAtOrigin) <= 0) {
      sendError(res, "No outstanding dues exist at the origin branch - no decision needed", 400);
      return;
    }

    const updated = await prisma.studentBranchTransfer.update({
      where: { id },
      data: { feeDuesOption },
    });
    sendSuccess(res, updated, "Fee dues option recorded");
  } catch (error) {
    sendError(res, "Failed to record fee dues decision", 500, (error as Error).message);
  }
};

/**
 * Destination Principal requests full academic data (beyond the
 * default summary) - origin Principal must approve/reject.
 */
export const requestFullAcademicData = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const transfer = await prisma.studentBranchTransfer.findUnique({ where: { id } });
    if (!transfer) { sendError(res, "Transfer not found", 404); return; }
    if (!canAccessBranch(req, transfer.destinationBranchId)) { sendError(res, "Transfer not found", 404); return; }
    if (transfer.academicDataAccess === "FULL") { sendError(res, "Full academic data is already unlocked", 400); return; }

    const updated = await prisma.studentBranchTransfer.update({
      where: { id },
      data: { fullDataRequestStatus: "PENDING", fullDataRequestedBy: req.user!.userId, fullDataRequestedAt: new Date() },
    });
    sendSuccess(res, updated, "Full data request sent to origin Principal");
  } catch (error) {
    sendError(res, "Failed to request full academic data", 500, (error as Error).message);
  }
};

export const respondToFullAcademicDataRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { decision, rejectionReason } = req.body;

    const transfer = await prisma.studentBranchTransfer.findUnique({ where: { id } });
    if (!transfer) { sendError(res, "Transfer not found", 404); return; }
    if (!canAccessBranch(req, transfer.originBranchId)) { sendError(res, "Transfer not found", 404); return; }
    if (transfer.fullDataRequestStatus !== "PENDING") { sendError(res, "No pending full-data request for this transfer", 400); return; }

    const updated = await prisma.studentBranchTransfer.update({
      where: { id },
      data: {
        fullDataRequestStatus: decision === "APPROVE" ? "APPROVED" : "REJECTED",
        fullDataApprovedBy: req.user!.userId,
        fullDataApprovedAt: new Date(),
        ...(decision === "APPROVE" && { academicDataAccess: "FULL" }),
        ...(decision === "REJECT" && { fullDataRejectionReason: rejectionReason }),
      },
    });
    sendSuccess(res, updated, `Full data request ${decision === "APPROVE" ? "approved - full academic data unlocked" : "rejected"}`);
  } catch (error) {
    sendError(res, "Failed to respond to full-data request", 500, (error as Error).message);
  }
};

/**
 * Completes an APPROVED student transfer: moves the Student record to
 * the destination branch, applies the fee-dues option's consequence
 * (student active immediately / inactive until cleared / blocked until
 * cleared at old branch), and auto-cancels any active scholarship
 * (spec Section 5 - branch-linked, must be reapplied at the new
 * branch).
 */
export const completeStudentTransfer = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const transfer = await prisma.studentBranchTransfer.findUnique({ where: { id }, include: { student: true } });
    if (!transfer) { sendError(res, "Transfer not found", 404); return; }
    if (!canAccessBranch(req, transfer.destinationBranchId)) { sendError(res, "Transfer not found", 404); return; }
    if (transfer.status !== "APPROVED") { sendError(res, "Transfer must be approved before it can be completed", 400); return; }

    const hasDues = transfer.outstandingDuesAtOrigin && Number(transfer.outstandingDuesAtOrigin) > 0;
    if (hasDues && !transfer.feeDuesOption) {
      sendError(res, "A fee dues option must be recorded before completing this transfer", 400);
      return;
    }

    // CLEAR_AT_OLD_BRANCH: dues must be cleared in the OLD branch's
    // ledger before admission proceeds at all - re-check live status
    // at completion time (in case new dues appeared since initiation).
    if (transfer.feeDuesOption === "CLEAR_AT_OLD_BRANCH") {
      const stillPending = await prisma.feeAssignment.count({
        where: { studentId: transfer.studentId, status: { in: ["PENDING", "PARTIAL", "OVERDUE"] } },
      });
      if (stillPending > 0) {
        sendError(res, "Outstanding dues at the old branch must be cleared before this transfer can be completed", 400);
        return;
      }
    }

    // CLEAR_DUES_AND_ADMIT: student stays inactive until cleared at
    // the NEW branch; CARRY_FORWARD: active immediately;
    // CLEAR_AT_OLD_BRANCH: already cleared (checked above), active.
    const newIsActive = transfer.feeDuesOption !== "CLEAR_DUES_AND_ADMIT";

    await prisma.$transaction([
      prisma.student.update({
        where: { id: transfer.studentId },
        data: {
          branchId: transfer.destinationBranchId,
          isActive: newIsActive,
          // Scholarship auto-cancelled on transfer (spec Section 5) -
          // must be reapplied/reassessed at the new branch.
          hasActiveScholarship: false,
        },
      }),
      prisma.studentDiscount.updateMany({
        where: { studentId: transfer.studentId, type: "MERIT_SCHOLARSHIP", isActive: true },
        data: { isActive: false },
      }),
      prisma.studentBranchTransfer.update({
        where: { id },
        data: { status: "COMPLETED", completedAt: new Date(), scholarshipAutoCancelled: transfer.student.hasActiveScholarship },
      }),
    ]);

    sendSuccess(res, null, "Student transfer completed");
  } catch (error) {
    sendError(res, "Failed to complete student transfer", 500, (error as Error).message);
  }
};

export const getStudentTransfers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const status = req.query.status as string | undefined;
    const where: any = {};
    if (status) where.status = status;
    if (req.user!.role !== UserRole.SUPER_ADMIN) {
      where.OR = [{ originBranchId: req.user!.branchId }, { destinationBranchId: req.user!.branchId }];
    }

    const transfers = await prisma.studentBranchTransfer.findMany({
      where,
      include: {
        student: { include: { user: { select: { name: true } } } },
        originBranch: { select: { name: true } },
        destinationBranch: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    sendSuccess(res, transfers, "Student transfers fetched");
  } catch (error) {
    sendError(res, "Failed to fetch student transfers", 500, (error as Error).message);
  }
};

// ===================== STAFF TRANSFER =====================

export const initiateStaffTransfer = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { staffId, destinationBranchId } = req.body;

    const staff = await prisma.staff.findUnique({ where: { id: staffId } });
    if (!staff) { sendError(res, "Staff not found", 404); return; }
    if (!canAccessBranch(req, staff.branchId)) { sendError(res, "Staff not found", 404); return; }

    const destinationBranch = await prisma.branch.findUnique({ where: { id: destinationBranchId } });
    if (!destinationBranch) { sendError(res, "Destination branch not found", 404); return; }
    if (destinationBranchId === staff.branchId) { sendError(res, "Destination branch must be different from the origin branch", 400); return; }

    const role = req.user!.role;
    const isDirector = isDirectorRole(role);
    const isPrincipal = isPrincipalRole(role);
    if (!isDirector && !isPrincipal) {
      sendError(res, "Only a Director or Principal can initiate a staff transfer", 403);
      return;
    }

    const transfer = await prisma.staffBranchTransfer.create({
      data: {
        staffId,
        originBranchId: staff.branchId,
        destinationBranchId,
        initiatedBy: req.user!.userId,
        initiatedByRole: isDirector ? "DIRECTOR" : "ORIGIN_PRINCIPAL",
        status: isDirector ? "APPROVED" : "PENDING",
        ...(isDirector && { destinationApprovedBy: req.user!.userId, destinationApprovedAt: new Date() }),
      },
    });

    sendSuccess(res, transfer, isDirector ? "Transfer initiated and auto-approved (Director)" : "Transfer request sent to destination Principal", 201);
  } catch (error) {
    sendError(res, "Failed to initiate staff transfer", 500, (error as Error).message);
  }
};

export const respondToStaffTransfer = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { decision, rejectionReason } = req.body;

    const transfer = await prisma.staffBranchTransfer.findUnique({ where: { id } });
    if (!transfer) { sendError(res, "Transfer request not found", 404); return; }
    if (!canAccessBranch(req, transfer.destinationBranchId)) { sendError(res, "Transfer request not found", 404); return; }
    if (transfer.status !== "PENDING") { sendError(res, "This request has already been decided", 400); return; }

    const updated = await prisma.staffBranchTransfer.update({
      where: { id },
      data: {
        status: decision === "APPROVE" ? "APPROVED" : "REJECTED",
        destinationApprovedBy: req.user!.userId,
        destinationApprovedAt: new Date(),
        ...(decision === "REJECT" && { rejectionReason }),
      },
    });
    sendSuccess(res, updated, `Transfer ${decision === "APPROVE" ? "approved" : "rejected"}`);
  } catch (error) {
    sendError(res, "Failed to respond to transfer request", 500, (error as Error).message);
  }
};

export const completeStaffTransfer = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const transfer = await prisma.staffBranchTransfer.findUnique({ where: { id } });
    if (!transfer) { sendError(res, "Transfer not found", 404); return; }
    if (!canAccessBranch(req, transfer.destinationBranchId)) { sendError(res, "Transfer not found", 404); return; }
    if (transfer.status !== "APPROVED") { sendError(res, "Transfer must be approved before it can be completed", 400); return; }

    await prisma.$transaction([
      prisma.staff.update({ where: { id: transfer.staffId }, data: { branchId: transfer.destinationBranchId } }),
      prisma.staffBranchTransfer.update({ where: { id }, data: { status: "COMPLETED", completedAt: new Date() } }),
    ]);

    sendSuccess(res, null, "Staff transfer completed");
  } catch (error) {
    sendError(res, "Failed to complete staff transfer", 500, (error as Error).message);
  }
};

export const getStaffTransfers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const status = req.query.status as string | undefined;
    const where: any = {};
    if (status) where.status = status;
    if (req.user!.role !== UserRole.SUPER_ADMIN) {
      where.OR = [{ originBranchId: req.user!.branchId }, { destinationBranchId: req.user!.branchId }];
    }

    const transfers = await prisma.staffBranchTransfer.findMany({
      where,
      include: {
        staff: { include: { user: { select: { name: true } } } },
        originBranch: { select: { name: true } },
        destinationBranch: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    sendSuccess(res, transfers, "Staff transfers fetched");
  } catch (error) {
    sendError(res, "Failed to fetch staff transfers", 500, (error as Error).message);
  }
};
