import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError, sendPaginated } from "../utils/response";
import { resolveBranchId, canAccessBranch } from "../utils/branchScope";
import { buildCsv, sendCsv, CsvColumn } from "../services/csvExport.service";

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
 * Below-threshold attendance list (Phase 6) - students whose current-
 * month attendance percentage falls below a configurable threshold
 * (default 75%, the common statutory/board minimum) so class teachers
 * and admins can proactively follow up rather than discovering the
 * problem only at exam-eligibility time.
 *
 * "Working days" here is approximated as the count of DISTINCT dates
 * that have at least one attendance record anywhere in the branch for
 * the month - i.e. days the school was actually open and attendance
 * was taken - rather than a fixed calendar-day count, since weekends/
 * holidays vary per school and this schema has no holiday calendar to
 * consult.
 */
interface AttendanceDefaultersQuery {
  branchId: string;
  threshold: number;
  month: number;
  year: number;
  classId?: string;
}

/** Shared query behind getAttendanceDefaultersList (JSON) and exportAttendanceDefaultersCsv (CSV). */
const fetchAttendanceDefaulters = async ({ branchId, threshold, month, year, classId }: AttendanceDefaultersQuery) => {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0, 23, 59, 59);

  const [workingDayRecords, students] = await Promise.all([
    prisma.studentAttendance.findMany({
      where: { student: { branchId }, date: { gte: startDate, lte: endDate }, period: null },
      select: { date: true },
      distinct: ["date"],
    }),
    prisma.student.findMany({
      where: { branchId, isActive: true, ...(classId ? { classId } : {}) },
      include: {
        user: { select: { name: true, phone: true } },
        class: { select: { name: true } },
        section: { select: { name: true } },
        attendances: { where: { date: { gte: startDate, lte: endDate }, period: null } },
      },
    }),
  ]);

  const workingDays = workingDayRecords.length;
  if (workingDays === 0) return { students: [], workingDays: 0 };

  const enriched = students
    .map((s) => {
      const presentDays = s.attendances.filter((a) => a.status === "PRESENT" || a.status === "LATE").length;
      const percentage = Math.round((presentDays / workingDays) * 1000) / 10;
      return {
        studentId: s.id,
        name: s.user.name,
        phone: s.user.phone,
        admissionNo: s.admissionNo,
        className: s.class.name,
        sectionName: s.section.name,
        presentDays,
        workingDays,
        percentage,
      };
    })
    .filter((s) => s.percentage < threshold)
    .sort((a, b) => a.percentage - b.percentage);

  return { students: enriched, workingDays };
};

const parseAttendanceDefaultersQuery = (req: AuthRequest): AttendanceDefaultersQuery | null => {
  const branchId = resolveBranchId(req);
  if (!branchId) return null;

  return {
    branchId,
    threshold: Math.min(Math.max(parseFloat(req.query.threshold as string) || 75, 0), 100),
    month: parseInt(req.query.month as string) || new Date().getMonth() + 1,
    year: parseInt(req.query.year as string) || new Date().getFullYear(),
    classId: req.query.classId as string | undefined,
  };
};

export const getAttendanceDefaultersList = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query = parseAttendanceDefaultersQuery(req);
    if (!query) { sendError(res, "Branch ID required", 400); return; }

    const { students, workingDays } = await fetchAttendanceDefaulters(query);

    if (workingDays === 0) {
      sendSuccess(res, { students: [], workingDays: 0, threshold: query.threshold }, "No attendance recorded for this month yet");
      return;
    }

    sendSuccess(
      res,
      { students, workingDays, threshold: query.threshold, count: students.length },
      "Attendance defaulters fetched"
    );
  } catch (error) {
    sendError(res, "Failed to fetch attendance defaulters", 500, (error as Error).message);
  }
};

type AttendanceDefaulterRow = Awaited<ReturnType<typeof fetchAttendanceDefaulters>>["students"][number];

const ATTENDANCE_DEFAULTER_CSV_COLUMNS: CsvColumn<AttendanceDefaulterRow>[] = [
  { header: "Student Name", accessor: (s) => s.name },
  { header: "Admission No", accessor: (s) => s.admissionNo },
  { header: "Phone", accessor: (s) => s.phone },
  { header: "Class", accessor: (s) => s.className },
  { header: "Section", accessor: (s) => s.sectionName },
  { header: "Present Days", accessor: (s) => s.presentDays },
  { header: "Working Days", accessor: (s) => s.workingDays },
  { header: "Attendance %", accessor: (s) => s.percentage },
];

/**
 * GET /api/reports/attendance-defaulters/export
 * CSV download of the below-threshold attendance list, for class
 * teachers/admins to share with parents or escalate.
 */
export const exportAttendanceDefaultersCsv = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query = parseAttendanceDefaultersQuery(req);
    if (!query) { sendError(res, "Branch ID required", 400); return; }

    const { students } = await fetchAttendanceDefaulters(query);
    const csv = buildCsv(students, ATTENDANCE_DEFAULTER_CSV_COLUMNS);

    sendCsv(res, `attendance-defaulters-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  } catch (error) {
    sendError(res, "Failed to export attendance defaulters", 500, (error as Error).message);
  }
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
