import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";

/**
 * Fee Collection Day Book (date-wise payment list)
 */
export const getCollectionDayBook = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = req.query.branchId as string || req.user!.branchId;
    const from = req.query.from as string;
    const to = req.query.to as string;

    if (!branchId) { sendError(res, "Branch ID required", 400); return; }

    const where: any = { branchId, status: "SUCCESS" };
    if (from || to) {
      where.paidAt = {};
      if (from) where.paidAt.gte = new Date(from);
      if (to) where.paidAt.lte = new Date(`${to}T23:59:59`);
    }

    const payments = await prisma.payment.findMany({
      where,
      orderBy: { paidAt: "desc" },
      include: {
        student: { include: { user: { select: { name: true } }, class: { select: { name: true } } } },
        feeAssignment: { include: { feeStructure: { include: { feeCategory: { select: { name: true } } } } } },
      },
    });

    const totalCollected = payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const totalLateFee = payments.reduce((sum, p) => sum + Number(p.lateFeeCharged), 0);

    sendSuccess(res, {
      payments,
      summary: { totalCollected, totalLateFee, totalReceipts: payments.length },
    }, "Collection day book fetched");
  } catch (error) {
    sendError(res, "Failed to fetch day book", 500, (error as Error).message);
  }
};

/**
 * Fee Defaulters List (students with overdue/pending fees)
 */
export const getDefaultersList = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = req.query.branchId as string || req.user!.branchId;
    const classId = req.query.classId as string;

    if (!branchId) { sendError(res, "Branch ID required", 400); return; }

    const where: any = {
      status: { in: ["PENDING", "PARTIAL", "OVERDUE"] },
      student: { branchId, isActive: true },
    };
    if (classId) where.student.classId = classId;

    const defaulters = await prisma.feeAssignment.findMany({
      where,
      include: {
        student: {
          include: {
            user: { select: { name: true, phone: true } },
            class: { select: { name: true } },
            section: { select: { name: true } },
          },
        },
        feeStructure: { include: { feeCategory: { select: { name: true } } } },
      },
      orderBy: { student: { class: { numericOrder: "asc" } } },
    });

    // Calculate pending amount for each
    const enriched = defaulters.map((d) => ({
      ...d,
      pendingAmount: Number(d.totalAmount) - Number(d.paidAmount) - Number(d.discount) + Number(d.lateFee),
    }));

    const totalPending = enriched.reduce((sum, d) => sum + d.pendingAmount, 0);

    sendSuccess(res, { defaulters: enriched, totalPending, totalDefaulters: enriched.length }, "Defaulters list fetched");
  } catch (error) {
    sendError(res, "Failed to fetch defaulters", 500, (error as Error).message);
  }
};

/**
 * Class-wise fee collection summary
 */
export const getClassWiseSummary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = req.query.branchId as string || req.user!.branchId;
    if (!branchId) { sendError(res, "Branch ID required", 400); return; }

    const classes = await prisma.class.findMany({
      where: { branchId },
      orderBy: { numericOrder: "asc" },
    });

    const summary: any[] = [];

    for (const cls of classes) {
      const assignments = await prisma.feeAssignment.findMany({
        where: { student: { classId: cls.id, branchId } },
      });

      const totalAssigned = assignments.reduce((s, a) => s + Number(a.totalAmount), 0);
      const totalCollected = assignments.reduce((s, a) => s + Number(a.paidAmount), 0);
      const totalPending = totalAssigned - totalCollected;
      const studentCount = await prisma.student.count({ where: { classId: cls.id, branchId, isActive: true } });

      summary.push({
        classId: cls.id,
        className: cls.name,
        studentCount,
        totalAssigned,
        totalCollected,
        totalPending,
        collectionPercent: totalAssigned > 0 ? Math.round((totalCollected / totalAssigned) * 100) : 0,
      });
    }

    const grandTotal = {
      totalAssigned: summary.reduce((s, c) => s + c.totalAssigned, 0),
      totalCollected: summary.reduce((s, c) => s + c.totalCollected, 0),
      totalPending: summary.reduce((s, c) => s + c.totalPending, 0),
    };

    sendSuccess(res, { summary, grandTotal }, "Class-wise summary fetched");
  } catch (error) {
    sendError(res, "Failed to fetch summary", 500, (error as Error).message);
  }
};
