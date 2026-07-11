import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { resolveBranchId, resolveEffectiveBranchId, canAccessBranch } from "../utils/branchScope";

/**
 * Create fee structure (class-wise, with frequency & late fee rules)
 */
export const createFeeStructure = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      academicYearId, classId, feeCategoryId,
      amount, frequency, dueDay, lateFeeType, lateFeeValue,
      installments, // optional: [{installmentNo, amount, dueDate}]
    } = req.body;
    // BUG FIX: the "Create Fee Structure" form has no branch-picker, so
    // req.body.branchId always arrived as "" - see
    // resolveEffectiveBranchId's doc comment.
    const branchId = resolveEffectiveBranchId(req, req.body.branchId);

    if (!branchId) {
      sendError(res, "Branch ID could not be resolved - please select a branch", 400);
      return;
    }
    if (!canAccessBranch(req, branchId)) {
      sendError(res, "Access denied: branch mismatch", 403);
      return;
    }
    // This form only ever creates class-wise structures - transport
    // fee structures (classId null, transportRouteId set) are created
    // exclusively by assignTransportFee (feeCollection.controller.ts),
    // which finds-or-creates its own route-keyed structure and never
    // goes through this endpoint.
    if (!classId) {
      sendError(res, "classId is required", 400);
      return;
    }

    // Check uniqueness
    const existing = await prisma.feeStructure.findUnique({
      where: { branchId_academicYearId_classId_feeCategoryId: { branchId, academicYearId, classId, feeCategoryId } },
    });
    if (existing) { sendError(res, "Fee structure already exists for this class + category + year", 400); return; }

    const structure = await prisma.feeStructure.create({
      data: {
        branchId, academicYearId, classId, feeCategoryId,
        amount, frequency, dueDay: dueDay || 10,
        lateFeeType: lateFeeType || "NONE",
        lateFeeValue: lateFeeValue || 0,
        isActive: true,
      },
    });

    // Create installments if provided
    if (installments && installments.length > 0) {
      await prisma.feeInstallment.createMany({
        data: installments.map((inst: any) => ({
          feeStructureId: structure.id,
          installmentNo: inst.installmentNo,
          amount: inst.amount,
          dueDate: new Date(inst.dueDate),
        })),
      });
    }

    const full = await prisma.feeStructure.findUnique({
      where: { id: structure.id },
      include: { feeCategory: true, class: true, installments: true },
    });

    sendSuccess(res, full, "Fee structure created", 201);
  } catch (error) {
    sendError(res, "Failed to create fee structure", 500, (error as Error).message);
  }
};

/**
 * Get fee structures (filterable by branch, class, year, category)
 */
export const getFeeStructures = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    const classId = req.query.classId as string;
    const academicYearId = req.query.academicYearId as string;

    const where: any = {};
    if (branchId) where.branchId = branchId;
    if (classId) where.classId = classId;
    if (academicYearId) where.academicYearId = academicYearId;

    const structures = await prisma.feeStructure.findMany({
      where,
      include: {
        feeCategory: { select: { name: true, code: true } },
        class: { select: { name: true } },
        // Present only for transport-route-wise structures (classId
        // null) - see the FeeStructure model's doc comment in
        // schema.prisma for why a structure is exactly one or the
        // other, never both.
        transportRoute: { select: { name: true, startPoint: true, endPoint: true } },
        academicYear: { select: { name: true } },
        installments: { orderBy: { installmentNo: "asc" } },
      },
      // Transport-route-wise structures have no class (classId null),
      // so they naturally sort after every class-wise structure here
      // (Postgres/Prisma puts NULLs last by default for an ascending
      // sort on a to-one relation's field).
      orderBy: [{ class: { numericOrder: "asc" } }, { feeCategory: { name: "asc" } }],
    });

    sendSuccess(res, structures, "Fee structures fetched");
  } catch (error) {
    sendError(res, "Failed to fetch fee structures", 500, (error as Error).message);
  }
};

/**
 * Update fee structure
 */
export const updateFeeStructure = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { amount, frequency, dueDay, lateFeeType, lateFeeValue, isActive } = req.body;

    const existing = await prisma.feeStructure.findUnique({ where: { id } });
    if (!existing) { sendError(res, "Fee structure not found", 404); return; }
    if (!canAccessBranch(req, existing.branchId)) { sendError(res, "Fee structure not found", 404); return; }

    const updated = await prisma.feeStructure.update({
      where: { id },
      data: {
        ...(amount !== undefined && { amount }),
        ...(frequency && { frequency }),
        ...(dueDay !== undefined && { dueDay }),
        ...(lateFeeType && { lateFeeType }),
        ...(lateFeeValue !== undefined && { lateFeeValue }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    sendSuccess(res, updated, "Fee structure updated");
  } catch (error) {
    sendError(res, "Failed to update fee structure", 500, (error as Error).message);
  }
};

/**
 * Delete fee structure (only if no assignments)
 */
export const deleteFeeStructure = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const count = await prisma.feeAssignment.count({ where: { feeStructureId: id } });
    if (count > 0) { sendError(res, `Cannot delete: ${count} students have this fee assigned`, 400); return; }

    await prisma.feeInstallment.deleteMany({ where: { feeStructureId: id } });
    await prisma.feeStructure.delete({ where: { id } });

    sendSuccess(res, null, "Fee structure deleted");
  } catch (error) {
    sendError(res, "Failed to delete fee structure", 500, (error as Error).message);
  }
};
