import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { canAccessBranch } from "../utils/branchScope";

/**
 * Appraisal Rating module (spec Section 8) - the 5 rating sources
 * feeding a staff member's increment decision:
 *  - STUDENT_WEEKLY: every student rates their assigned teacher, weekly.
 *  - PARENT_POST_PTM: every parent fills a rating+feedback form after
 *    each PTM.
 *  - PRINCIPAL_TEACHER_MUTUAL / VP_TEACHER_MUTUAL: mutual quarterly
 *    rating (Principal rates teacher AND teacher rates Principal, same
 *    for VP) - `subjectStaffId` is whoever is being rated in THIS row;
 *    the reverse direction (teacher rating the Principal/VP) is
 *    submitted as its own separate row with subjectStaffId/raterStaffId
 *    swapped, not inferred automatically.
 *  - ATTENDANCE_PERFORMANCE: continuous, auto-tracked - see
 *    recordAttendancePerformanceRating below, called from a scheduled
 *    job or admin action rather than a person submitting a form.
 */

export const submitAppraisalRating = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { subjectStaffId, source, raterStaffId, raterStudentId, score, maxScore, feedback, periodLabel } = req.body;

    const subjectStaff = await prisma.staff.findUnique({ where: { id: subjectStaffId }, select: { branchId: true } });
    if (!subjectStaff) { sendError(res, "Staff member being rated not found", 404); return; }
    if (!canAccessBranch(req, subjectStaff.branchId)) { sendError(res, "Staff member being rated not found", 404); return; }

    // Validate the rater reference matches the source (spec: each
    // source has exactly one valid kind of rater).
    if (source === "STUDENT_WEEKLY") {
      if (!raterStudentId) { sendError(res, "raterStudentId is required for STUDENT_WEEKLY ratings", 400); return; }
      const student = await prisma.student.findUnique({ where: { id: raterStudentId }, select: { userId: true } });
      if (req.user!.role === "STUDENT" && student?.userId !== req.user!.userId) {
        sendError(res, "You may only submit a rating as yourself", 403);
        return;
      }
    } else if (source === "PARENT_POST_PTM") {
      // Parent has no Staff record - raterUserId (the parent's own
      // userId) is used instead of raterStaffId for this one source.
    } else {
      if (!raterStaffId) { sendError(res, "raterStaffId is required for this rating source", 400); return; }
    }

    const rating = await prisma.appraisalRating.create({
      data: {
        branchId: subjectStaff.branchId, subjectStaffId, source,
        raterStaffId: source === "PARENT_POST_PTM" ? undefined : raterStaffId,
        raterStudentId: source === "STUDENT_WEEKLY" ? raterStudentId : undefined,
        raterUserId: source === "PARENT_POST_PTM" ? req.user!.userId : undefined,
        score, maxScore, feedback, periodLabel,
      },
    });
    sendSuccess(res, rating, "Rating submitted", 201);
  } catch (error) {
    sendError(res, "Failed to submit rating", 500, (error as Error).message);
  }
};

/**
 * "Increment screen" (spec Section 8) - raw data + average per rating
 * source, for one staff member, shown to the Director before they
 * manually enter the increment %. Deliberately no auto-formula here -
 * this is display-only aggregation; enterIncrement below is the only
 * place the actual decision is recorded.
 */
export const getIncrementScreenData = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { staffId } = req.params;
    const staff = await prisma.staff.findUnique({ where: { id: staffId }, select: { branchId: true } });
    if (!staff) { sendError(res, "Staff not found", 404); return; }
    if (!canAccessBranch(req, staff.branchId)) { sendError(res, "Staff not found", 404); return; }

    const ratings = await prisma.appraisalRating.findMany({
      where: { subjectStaffId: staffId },
      orderBy: { createdAt: "desc" },
    });

    const sources = ["STUDENT_WEEKLY", "PARENT_POST_PTM", "PRINCIPAL_TEACHER_MUTUAL", "VP_TEACHER_MUTUAL", "ATTENDANCE_PERFORMANCE"] as const;
    const bySource = sources.map((source) => {
      const rows = ratings.filter((r) => r.source === source);
      const avgPct = rows.length > 0
        ? rows.reduce((sum, r) => sum + (Number(r.score) / Number(r.maxScore)) * 100, 0) / rows.length
        : null;
      return { source, count: rows.length, averagePercent: avgPct !== null ? Math.round(avgPct * 100) / 100 : null, raw: rows };
    });

    const priorIncrements = await prisma.salaryIncrement.findMany({ where: { staffId }, orderBy: { createdAt: "desc" } });

    sendSuccess(res, { staffId, bySource, priorIncrements }, "Increment screen data fetched");
  } catch (error) {
    sendError(res, "Failed to fetch increment screen data", 500, (error as Error).message);
  }
};

/**
 * Director manually enters the increment % (spec Section 8 - "no
 * auto-formula"). Restricted at the route level to ADMIN (BRANCH_ADMIN
 * /SUPER_ADMIN = "Director" per this codebase's role naming).
 */
export const enterIncrement = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { staffId, periodLabel, incrementPct, notes } = req.body;

    const staff = await prisma.staff.findUnique({ where: { id: staffId }, select: { branchId: true } });
    if (!staff) { sendError(res, "Staff not found", 404); return; }
    if (!canAccessBranch(req, staff.branchId)) { sendError(res, "Staff not found", 404); return; }

    const increment = await prisma.salaryIncrement.upsert({
      where: { staffId_periodLabel: { staffId, periodLabel } },
      update: { incrementPct, notes, enteredBy: req.user!.userId },
      create: { staffId, periodLabel, incrementPct, notes, enteredBy: req.user!.userId },
    });
    sendSuccess(res, increment, "Increment recorded", 201);
  } catch (error) {
    sendError(res, "Failed to record increment", 500, (error as Error).message);
  }
};

export const getSalaryIncrements = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { staffId } = req.params;
    const staff = await prisma.staff.findUnique({ where: { id: staffId }, select: { branchId: true } });
    if (!staff) { sendError(res, "Staff not found", 404); return; }
    if (!canAccessBranch(req, staff.branchId)) { sendError(res, "Staff not found", 404); return; }

    const increments = await prisma.salaryIncrement.findMany({ where: { staffId }, orderBy: { createdAt: "desc" } });
    sendSuccess(res, increments, "Salary increments fetched");
  } catch (error) {
    sendError(res, "Failed to fetch salary increments", 500, (error as Error).message);
  }
};

/**
 * Continuous, auto-tracked attendance-performance rating (spec Section
 * 8) - derives a score from a staff member's attendance % over a
 * given month, and records it as an ATTENDANCE_PERFORMANCE
 * AppraisalRating row so it shows up alongside the other 4 sources on
 * the increment screen. Meant to be called periodically (e.g. once a
 * month, by an admin action or a future scheduled job) rather than
 * per-request.
 */
export const recordAttendancePerformanceRating = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { staffId, month, year } = req.body;

    const staff = await prisma.staff.findUnique({ where: { id: staffId }, select: { branchId: true } });
    if (!staff) { sendError(res, "Staff not found", 404); return; }
    if (!canAccessBranch(req, staff.branchId)) { sendError(res, "Staff not found", 404); return; }

    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59);
    const attendances = await prisma.staffAttendance.findMany({ where: { staffId, date: { gte: start, lte: end } } });
    if (attendances.length === 0) {
      sendError(res, "No attendance records found for this staff member in this month", 400);
      return;
    }

    const presentCount = attendances.filter((a) => a.status === "PRESENT" || a.status === "LATE" || a.status === "ON_LEAVE").length;
    const percent = (presentCount / attendances.length) * 100;

    const rating = await prisma.appraisalRating.create({
      data: {
        branchId: staff.branchId, subjectStaffId: staffId, source: "ATTENDANCE_PERFORMANCE",
        raterStaffId: null, score: Math.round(percent * 100) / 100, maxScore: 100,
        periodLabel: `${year}-${String(month).padStart(2, "0")}`,
      },
    });
    sendSuccess(res, rating, "Attendance performance rating recorded", 201);
  } catch (error) {
    sendError(res, "Failed to record attendance performance rating", 500, (error as Error).message);
  }
};
