import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { resolveBranchId, canAccessBranch } from "../utils/branchScope";
import { buildCsv, sendCsv, CsvColumn } from "../services/csvExport.service";

/**
 * Fee Collection Day Book (date-wise payment list)
 */
export const getCollectionDayBook = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
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
 * Shared query behind both getDefaultersList (JSON) and
 * exportDefaultersCsv (CSV) - kept in one place so the two never drift
 * in what counts as a "defaulter". Exported (not just used internally)
 * so workers/reportWorker.ts can build the exact same CSV in the
 * background-job path (see queues/report.queue.ts) without duplicating
 * this query.
 */
export const fetchDefaulters = async (branchId: string, classId?: string) => {
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

  return defaulters.map((d) => ({
    ...d,
    pendingAmount: Number(d.totalAmount) - Number(d.paidAmount) - Number(d.discount) + Number(d.lateFee),
  }));
};

/**
 * Fee Defaulters List (students with overdue/pending fees)
 */
export const getDefaultersList = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    if (!branchId) { sendError(res, "Branch ID required", 400); return; }

    const enriched = await fetchDefaulters(branchId, req.query.classId as string | undefined);
    const totalPending = enriched.reduce((sum, d) => sum + d.pendingAmount, 0);

    sendSuccess(res, { defaulters: enriched, totalPending, totalDefaulters: enriched.length }, "Defaulters list fetched");
  } catch (error) {
    sendError(res, "Failed to fetch defaulters", 500, (error as Error).message);
  }
};

export type DefaulterRow = Awaited<ReturnType<typeof fetchDefaulters>>[number];

export const DEFAULTER_CSV_COLUMNS: CsvColumn<DefaulterRow>[] = [
  { header: "Student Name", accessor: (d) => d.student.user.name },
  { header: "Phone", accessor: (d) => d.student.user.phone },
  { header: "Class", accessor: (d) => d.student.class.name },
  { header: "Section", accessor: (d) => d.student.section.name },
  { header: "Fee Category", accessor: (d) => d.feeStructure.feeCategory.name },
  { header: "Pending Amount", accessor: (d) => d.pendingAmount.toFixed(2) },
  { header: "Status", accessor: (d) => d.status },
];

/**
 * GET /api/fees/reports/defaulters/export
 * CSV download of the same defaulter list as getDefaultersList, for
 * finance staff to share with the accounts team or import into Excel
 * for follow-up calling lists.
 */
export const exportDefaultersCsv = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    if (!branchId) { sendError(res, "Branch ID required", 400); return; }

    const enriched = await fetchDefaulters(branchId, req.query.classId as string | undefined);
    const csv = buildCsv(enriched, DEFAULTER_CSV_COLUMNS);

    sendCsv(res, `fee-defaulters-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  } catch (error) {
    sendError(res, "Failed to export defaulters", 500, (error as Error).message);
  }
};

/**
 * Fee Collection Trend (Phase 6) - daily collected amount for the last
 * N days (default 30), for the "Fee Collection Trend" line chart on
 * the executive dashboard. Grouped in JS rather than a Prisma
 * `groupBy` on `paidAt` because `groupBy` on a DateTime column groups
 * by the exact timestamp, not by calendar day - a raw SQL
 * `DATE_TRUNC` would be the "correct" DB-side approach, but doing the
 * bucketing here keeps this portable across the SQLite-in-tests /
 * Postgres-in-prod split this codebase already relies on for its
 * mocked-Prisma unit tests.
 */
export const getFeeCollectionTrend = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    if (!branchId) { sendError(res, "Branch ID required", 400); return; }

    const days = Math.min(parseInt(req.query.days as string) || 30, 365);
    const since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);

    const payments = await prisma.payment.findMany({
      where: { branchId, status: "SUCCESS", paidAt: { gte: since } },
      select: { amount: true, paidAt: true },
    });

    // Bucket into a Map keyed by "YYYY-MM-DD" so every day in the
    // range appears in the output (even with zero collections) -
    // important for a line chart, which would otherwise show
    // misleading gaps as if no data existed for that day at all.
    const buckets = new Map<string, number>();
    for (let i = 0; i < days; i++) {
      const d = new Date(since);
      d.setDate(d.getDate() + i);
      buckets.set(d.toISOString().slice(0, 10), 0);
    }
    for (const p of payments) {
      const key = new Date(p.paidAt).toISOString().slice(0, 10);
      buckets.set(key, (buckets.get(key) || 0) + Number(p.amount));
    }

    const trend = Array.from(buckets.entries()).map(([date, amount]) => ({ date, amount }));
    const totalCollected = trend.reduce((sum, t) => sum + t.amount, 0);

    sendSuccess(res, { trend, totalCollected, days }, "Fee collection trend fetched");
  } catch (error) {
    sendError(res, "Failed to fetch collection trend", 500, (error as Error).message);
  }
};

/**
 * Payment Mode Breakdown (Phase 6) - how much was collected via each
 * PaymentMode (CASH, UPI, ONLINE_RAZORPAY, etc) within an optional date
 * range, for a pie/bar chart showing collection channel mix.
 */
export const getPaymentModeBreakdown = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    if (!branchId) { sendError(res, "Branch ID required", 400); return; }

    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    const where: any = { branchId, status: "SUCCESS" };
    if (from || to) {
      where.paidAt = {};
      if (from) where.paidAt.gte = new Date(from);
      if (to) where.paidAt.lte = new Date(`${to}T23:59:59`);
    }

    const breakdown = await prisma.payment.groupBy({
      by: ["paymentMode"],
      where,
      _sum: { amount: true },
      _count: true,
    });

    const result = breakdown.map((b) => ({
      paymentMode: b.paymentMode,
      totalAmount: Number(b._sum.amount || 0),
      transactionCount: b._count,
    }));

    sendSuccess(res, result, "Payment mode breakdown fetched");
  } catch (error) {
    sendError(res, "Failed to fetch payment mode breakdown", 500, (error as Error).message);
  }
};

/**
 * Class-wise fee collection summary
 */
export const getClassWiseSummary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
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
