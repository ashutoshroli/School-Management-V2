import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError, sendPaginated } from "../utils/response";
import { resolveBranchId, canAccessBranch } from "../utils/branchScope";

/**
 * Admin Dashboard stats
 */
export const getDashboardStats = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    const where = branchId ? { branchId } : {};

    const [totalStudents, totalStaff, totalClasses] = await Promise.all([
      prisma.student.count({ where: { ...where, isActive: true } }),
      prisma.staff.count({ where: { ...where, isActive: true } }),
      prisma.class.count({ where }),
    ]);

    // Fee stats (current month)
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const feeCollectedMonth = await prisma.payment.aggregate({
      where: { ...where, status: "SUCCESS", paidAt: { gte: monthStart, lte: monthEnd } },
      _sum: { amount: true },
    });

    const feePending = await prisma.feeAssignment.aggregate({
      where: { student: where, status: { in: ["PENDING", "PARTIAL", "OVERDUE"] } },
      _sum: { totalAmount: true },
    });
    const feePaid = await prisma.feeAssignment.aggregate({
      where: { student: where, status: { in: ["PENDING", "PARTIAL", "OVERDUE"] } },
      _sum: { paidAmount: true },
    });
    const totalPending = Number(feePending._sum.totalAmount || 0) - Number(feePaid._sum.paidAmount || 0);

    // Attendance today
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayAttendance = await prisma.studentAttendance.count({
      where: { student: where, date: today, status: "PRESENT" },
    });
    const totalActiveStudents = totalStudents || 1;
    const attendancePercent = Math.round((todayAttendance / totalActiveStudents) * 100);

    // Staff on leave today
    const staffOnLeave = await prisma.staffAttendance.count({
      where: { staff: where, date: today, status: "ON_LEAVE" },
    });

    sendSuccess(res, {
      totalStudents,
      totalStaff,
      totalClasses,
      feeCollectedMonth: Number(feeCollectedMonth._sum.amount || 0),
      feePending: totalPending,
      attendanceToday: attendancePercent,
      staffOnLeave,
    }, "Dashboard stats fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Multi-branch consolidated view (Super Admin)
 */
export const getMultiBranchSummary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branches = await prisma.branch.findMany({
      where: { isActive: true },
      include: { _count: { select: { students: true, staff: true } } },
    });

    const summary = await Promise.all(branches.map(async (branch) => {
      const feeCollected = await prisma.payment.aggregate({
        where: { branchId: branch.id, status: "SUCCESS" },
        _sum: { amount: true },
      });
      const feePendingAgg = await prisma.feeAssignment.aggregate({
        where: { student: { branchId: branch.id }, status: { in: ["PENDING", "PARTIAL", "OVERDUE"] } },
        _sum: { totalAmount: true, paidAmount: true },
      });
      const pending = Number(feePendingAgg._sum.totalAmount || 0) - Number(feePendingAgg._sum.paidAmount || 0);

      return {
        branchId: branch.id,
        branchName: branch.name,
        city: branch.city,
        students: branch._count.students,
        staff: branch._count.staff,
        totalFeeCollected: Number(feeCollected._sum.amount || 0),
        feePending: pending,
      };
    }));

    const grandTotal = {
      totalStudents: summary.reduce((s, b) => s + b.students, 0),
      totalStaff: summary.reduce((s, b) => s + b.staff, 0),
      totalCollected: summary.reduce((s, b) => s + b.totalFeeCollected, 0),
      totalPending: summary.reduce((s, b) => s + b.feePending, 0),
    };

    sendSuccess(res, { branches: summary, grandTotal }, "Multi-branch summary fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Attendance analytics (class-wise monthly)
 */
export const getAttendanceAnalytics = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year as string) || new Date().getFullYear();

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    const classes = await prisma.class.findMany({ where: { branchId }, orderBy: { numericOrder: "asc" } });

    const analytics = await Promise.all(classes.map(async (cls) => {
      const students = await prisma.student.count({ where: { classId: cls.id, isActive: true } });
      const totalRecords = await prisma.studentAttendance.count({
        where: { student: { classId: cls.id }, date: { gte: startDate, lte: endDate } },
      });
      const presentRecords = await prisma.studentAttendance.count({
        where: { student: { classId: cls.id }, date: { gte: startDate, lte: endDate }, status: { in: ["PRESENT", "LATE"] } },
      });
      const percentage = totalRecords > 0 ? Math.round((presentRecords / totalRecords) * 100) : 0;

      return { className: cls.name, students, percentage, totalRecords, presentRecords };
    }));

    sendSuccess(res, analytics, "Attendance analytics fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Academic analytics (class-wise exam performance)
 */
export const getAcademicAnalytics = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);

    const classes = await prisma.class.findMany({ where: { branchId }, orderBy: { numericOrder: "asc" } });

    const analytics = await Promise.all(classes.map(async (cls) => {
      const marks = await prisma.mark.findMany({
        where: { exam: { classId: cls.id } },
      });

      if (marks.length === 0) return { className: cls.name, avgPercent: 0, passPercent: 0, totalStudents: 0 };

      // Group by student
      const studentMarks: Record<string, { total: number; max: number }> = {};
      for (const m of marks) {
        if (!studentMarks[m.studentId]) studentMarks[m.studentId] = { total: 0, max: 0 };
        studentMarks[m.studentId].total += Number(m.obtainedMarks);
        studentMarks[m.studentId].max += Number(m.maxMarks);
      }

      const percentages = Object.values(studentMarks).map(s => s.max > 0 ? (s.total / s.max) * 100 : 0);
      const avgPercent = Math.round(percentages.reduce((a, b) => a + b, 0) / percentages.length);
      const passPercent = Math.round((percentages.filter(p => p >= 33).length / percentages.length) * 100);

      return { className: cls.name, avgPercent, passPercent, totalStudents: Object.keys(studentMarks).length };
    }));

    sendSuccess(res, analytics, "Academic analytics fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Audit log (SUPER_ADMIN / BRANCH_ADMIN)
 *
 * Note: AuditLog rows don't carry a branchId of their own (the model
 * only has userId/module/entityId - see schema) - branch scoping for a
 * BRANCH_ADMIN is approximated by only showing entries created by
 * users who belong to their branch (via the User->Staff/Student
 * relation), which is not a perfect boundary (e.g. a SUPER_ADMIN's
 * actions on a specific branch would still only show up for another
 * SUPER_ADMIN) but avoids leaking a Branch Admin's view into other
 * branches' activity for the common case.
 */
export const getAuditLog = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const skip = (page - 1) * limit;
    const module = req.query.module as string | undefined;
    const action = req.query.action as string | undefined;

    const where: any = {};
    if (module) where.module = module;
    if (action) where.action = action;

    if (req.user!.role !== "SUPER_ADMIN") {
      const branchId = resolveBranchId(req);
      const [staffUserIds, studentUserIds] = await Promise.all([
        prisma.staff.findMany({ where: { branchId }, select: { userId: true } }),
        prisma.student.findMany({ where: { branchId }, select: { userId: true } }),
      ]);
      where.userId = { in: [...staffUserIds.map((s) => s.userId), ...studentUserIds.map((s) => s.userId), req.user!.userId] };
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.auditLog.count({ where }),
    ]);

    // Attach a friendly user name/email for display without requiring
    // the frontend to make N follow-up requests.
    const userIds = [...new Set(logs.map((l) => l.userId))];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true, role: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const enriched = logs.map((log) => ({ ...log, user: userMap.get(log.userId) || null }));

    sendPaginated(res, enriched, total, page, limit, "Audit log fetched");
  } catch (error) {
    sendError(res, "Failed", 500, (error as Error).message);
  }
};

/**
 * HR analytics (staff cost, attendance, leave)
 */
export const getHRAnalytics = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year as string) || new Date().getFullYear();

    // Payroll cost
    const payslips = await prisma.payslip.findMany({
      where: { month, year, staff: { branchId } },
    });
    const totalSalaryCost = payslips.reduce((s, p) => s + Number(p.netPay), 0);
    const totalPF = payslips.reduce((s, p) => s + Number(p.pfAmount), 0);
    const totalESI = payslips.reduce((s, p) => s + Number(p.esiAmount), 0);
    const totalTDS = payslips.reduce((s, p) => s + Number(p.tdsAmount), 0);

    // Staff attendance this month
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    const totalStaff = await prisma.staff.count({ where: { branchId, isActive: true } });
    const attendanceRecords = await prisma.staffAttendance.count({
      where: { staff: { branchId }, date: { gte: startDate, lte: endDate } },
    });
    const presentRecords = await prisma.staffAttendance.count({
      where: { staff: { branchId }, date: { gte: startDate, lte: endDate }, status: { in: ["PRESENT", "LATE"] } },
    });
    const staffAttendancePercent = attendanceRecords > 0 ? Math.round((presentRecords / attendanceRecords) * 100) : 0;

    // Leave utilization
    const leavesApproved = await prisma.leaveApplication.count({
      where: { staff: { branchId }, status: "APPROVED", fromDate: { gte: startDate, lte: endDate } },
    });

    sendSuccess(res, {
      totalSalaryCost, totalPF, totalESI, totalTDS,
      totalStaff, staffAttendancePercent, leavesApproved,
      payslipCount: payslips.length,
    }, "HR analytics fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};
