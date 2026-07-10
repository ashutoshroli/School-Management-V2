import { Response } from "express";
import { UserRole } from "@prisma/client";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { canAccessStudentRecord } from "../utils/studentAccess";

/**
 * GET /api/parent/children
 * Returns the list of students linked to the currently logged-in PARENT
 * (or, for a STUDENT login, just their own single record) - the
 * frontend "child switcher" UI is driven by this list.
 */
export const getMyChildren = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const role = req.user!.role;

    if (role === UserRole.STUDENT) {
      const student = await prisma.student.findUnique({
        where: { userId },
        include: {
          user: { select: { name: true, email: true, avatar: true } },
          class: { select: { name: true } },
          section: { select: { name: true } },
          branch: { select: { name: true } },
        },
      });
      sendSuccess(res, student ? [student] : [], "Children fetched");
      return;
    }

    if (role === UserRole.PARENT) {
      const links = await prisma.studentParent.findMany({
        where: { parent: { userId } },
        include: {
          student: {
            include: {
              user: { select: { name: true, email: true, avatar: true } },
              class: { select: { name: true } },
              section: { select: { name: true } },
              branch: { select: { name: true } },
            },
          },
        },
      });
      sendSuccess(res, links.map((l) => l.student), "Children fetched");
      return;
    }

    sendError(res, "This endpoint is only available to student/parent accounts", 403);
  } catch (error) {
    sendError(res, "Failed to fetch children", 500, (error as Error).message);
  }
};

/**
 * GET /api/parent/children/:studentId/summary
 * A single "at a glance" dashboard payload for one child: pending fees
 * total, this month's attendance percentage, and upcoming/unsubmitted
 * homework count. Scoped to the caller's own child (or own record, for
 * a STUDENT login) via canAccessStudentRecord.
 */
export const getChildSummary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { studentId } = req.params;

    if (!(await canAccessStudentRecord(req, studentId))) {
      sendError(res, "You do not have access to this student's data", 403);
      return;
    }

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { classId: true, sectionId: true },
    });
    if (!student) {
      sendError(res, "Student not found", 404);
      return;
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const [pendingAssignments, attendanceRecords, homeworks, submittedHomeworkIds] = await Promise.all([
      prisma.feeAssignment.findMany({
        where: { studentId, status: { in: ["PENDING", "PARTIAL", "OVERDUE"] } },
        select: { totalAmount: true, paidAmount: true, discount: true, lateFee: true },
      }),
      prisma.studentAttendance.findMany({
        where: { studentId, date: { gte: monthStart, lte: monthEnd }, period: null },
        select: { status: true },
      }),
      prisma.homework.findMany({
        where: { classId: student.classId, OR: [{ sectionId: student.sectionId }, { sectionId: null }] },
        select: { id: true, title: true, dueDate: true },
        orderBy: { dueDate: "desc" },
        take: 10,
      }),
      prisma.homeworkSubmission.findMany({
        where: { studentId },
        select: { homeworkId: true },
      }),
    ]);

    const pendingFeeTotal = pendingAssignments.reduce(
      (sum, a) => sum + (Number(a.totalAmount) - Number(a.paidAmount) - Number(a.discount) + Number(a.lateFee)),
      0
    );

    const presentDays = attendanceRecords.filter((r) => r.status === "PRESENT" || r.status === "LATE").length;
    const attendancePercentage = attendanceRecords.length > 0 ? Math.round((presentDays / attendanceRecords.length) * 100) : null;

    const submittedSet = new Set(submittedHomeworkIds.map((s) => s.homeworkId));
    const pendingHomework = homeworks.filter((h) => !submittedSet.has(h.id) && new Date(h.dueDate) >= now);

    sendSuccess(res, {
      pendingFeeTotal: Math.max(0, pendingFeeTotal),
      attendancePercentage,
      pendingHomeworkCount: pendingHomework.length,
      pendingHomework,
    }, "Summary fetched");
  } catch (error) {
    sendError(res, "Failed to fetch summary", 500, (error as Error).message);
  }
};
