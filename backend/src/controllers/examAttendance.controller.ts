import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { canAccessBranch } from "../utils/branchScope";

/**
 * Per-sitting exam attendance - deliberately separate from
 * StudentAttendance (daily roll call). A student can be present for
 * daily attendance but absent for one specific exam paper, or vice
 * versa (e.g. arrived late to school but made it in time for the exam).
 */

/**
 * POST /api/academics/exams/schedule/:examScheduleId/attendance
 * body: { roomId?, records: [{studentId, status, remarks?}] }
 * Bulk, room-wise - an invigilator marks everyone allocated to their
 * room in one call. When roomId is supplied, every studentId must
 * actually be seated in THAT room for this schedule entry (via
 * ExamSeatAllocation) - prevents an invigilator for Room A accidentally
 * (or maliciously) marking attendance for students seated in Room B.
 * When roomId is omitted, any student enrolled in the exam's class may
 * be marked (e.g. for a class with no seat plan generated yet).
 */
export const markExamAttendance = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { examScheduleId } = req.params;
    const { roomId, records } = req.body;

    const schedule = await prisma.examSchedule.findUnique({
      where: { id: examScheduleId },
      include: { exam: { include: { class: { select: { id: true, branchId: true } } } } },
    });
    if (!schedule) { sendError(res, "Exam schedule entry not found", 404); return; }
    if (!canAccessBranch(req, schedule.exam.class.branchId)) { sendError(res, "Exam schedule entry not found", 404); return; }

    if (!Array.isArray(records) || records.length === 0) {
      sendError(res, "records must be a non-empty array", 400);
      return;
    }

    const studentIds = records.map((r: any) => r.studentId);

    if (roomId) {
      // SECURITY: every student being marked must actually be seated
      // in THIS room for this schedule entry - see this function's
      // doc comment above.
      const seated = await prisma.examSeatAllocation.findMany({
        where: { examScheduleId, roomId, studentId: { in: studentIds } },
        select: { studentId: true },
      });
      const seatedIds = new Set(seated.map((s) => s.studentId));
      const notSeatedHere = studentIds.filter((id: string) => !seatedIds.has(id));
      if (notSeatedHere.length > 0) {
        sendError(res, `${notSeatedHere.length} student(s) are not seated in this room for this exam`, 400);
        return;
      }
    } else {
      // No room scoping - just confirm every student belongs to this
      // exam's class (branch-safety, not an invigilator-room check).
      const validCount = await prisma.student.count({ where: { id: { in: studentIds }, classId: schedule.exam.classId } });
      if (validCount !== studentIds.length) {
        sendError(res, "One or more students do not belong to this exam's class", 400);
        return;
      }
    }

    let saved = 0;
    await prisma.$transaction(async (tx) => {
      for (const r of records) {
        await tx.examAttendance.upsert({
          where: { examScheduleId_studentId: { examScheduleId, studentId: r.studentId } },
          update: { status: r.status, remarks: r.remarks || null, markedBy: req.user!.userId },
          create: { examScheduleId, studentId: r.studentId, status: r.status, remarks: r.remarks || null, markedBy: req.user!.userId },
        });
        saved++;
      }
    });

    sendSuccess(res, { saved }, `${saved} attendance record(s) saved`);
  } catch (error) { sendError(res, "Failed to mark exam attendance", 500, (error as Error).message); }
};

/**
 * GET /api/academics/exams/schedule/:examScheduleId/attendance
 * Room-wise listing for one subject sitting - pre-fills from
 * ExamSeatAllocation (every seated student, defaulting to no
 * attendance marked yet) so the invigilator's marking UI can show the
 * full room roster even before anyone's been marked, rather than only
 * showing students that already have an ExamAttendance row.
 */
export const getExamAttendance = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { examScheduleId } = req.params;

    const schedule = await prisma.examSchedule.findUnique({
      where: { id: examScheduleId },
      include: { exam: { include: { class: { select: { branchId: true } } } } },
    });
    if (!schedule) { sendError(res, "Exam schedule entry not found", 404); return; }
    if (!canAccessBranch(req, schedule.exam.class.branchId)) { sendError(res, "Exam schedule entry not found", 404); return; }

    const [allocations, attendances] = await Promise.all([
      prisma.examSeatAllocation.findMany({
        where: { examScheduleId },
        include: {
          room: { select: { id: true, roomNo: true, name: true } },
          student: { select: { id: true, admissionNo: true, rollNo: true, user: { select: { name: true } }, section: { select: { name: true } } } },
        },
        orderBy: [{ roomId: "asc" }, { seatNo: "asc" }],
      }),
      prisma.examAttendance.findMany({ where: { examScheduleId } }),
    ]);

    const attendanceByStudent = new Map(attendances.map((a) => [a.studentId, a]));

    if (allocations.length > 0) {
      const byRoom: Record<string, any> = {};
      for (const a of allocations) {
        const key = a.roomId;
        if (!byRoom[key]) byRoom[key] = { roomId: a.roomId, roomNo: a.room.roomNo, roomName: a.room.name, students: [] };
        const existing = attendanceByStudent.get(a.studentId);
        byRoom[key].students.push({
          studentId: a.studentId,
          studentName: a.student.user.name,
          admissionNo: a.student.admissionNo,
          rollNo: a.student.rollNo,
          sectionName: a.student.section?.name,
          seatNo: a.seatNo,
          status: existing?.status || null,
          remarks: existing?.remarks || null,
        });
      }
      sendSuccess(res, { source: "SEAT_PLAN", rooms: Object.values(byRoom) }, "Exam attendance fetched");
      return;
    }

    // No seat plan generated for this sitting yet - fall back to every
    // active student in the exam's class, unroomed.
    const students = await prisma.student.findMany({
      where: { classId: schedule.exam.classId, isActive: true },
      select: { id: true, admissionNo: true, rollNo: true, user: { select: { name: true } }, section: { select: { name: true } } },
      orderBy: { rollNo: "asc" },
    });
    const list = students.map((s) => {
      const existing = attendanceByStudent.get(s.id);
      return {
        studentId: s.id,
        studentName: s.user.name,
        admissionNo: s.admissionNo,
        rollNo: s.rollNo,
        sectionName: s.section?.name,
        status: existing?.status || null,
        remarks: existing?.remarks || null,
      };
    });
    sendSuccess(res, { source: "CLASS_ROSTER", rooms: [{ roomId: null, roomNo: null, roomName: null, students: list }] }, "Exam attendance fetched");
  } catch (error) { sendError(res, "Failed to fetch exam attendance", 500, (error as Error).message); }
};

/**
 * GET /api/academics/exams/:examId/attendance-summary
 * Aggregated present/absent/unfair-means/late counts across EVERY
 * subject sitting in the exam - a quick "how did attendance go for
 * this whole exam" view, rather than checking each subject one at a
 * time.
 */
export const getExamAttendanceSummary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { examId } = req.params;

    const exam = await prisma.exam.findUnique({ where: { id: examId }, include: { class: { select: { branchId: true } } } });
    if (!exam) { sendError(res, "Exam not found", 404); return; }
    if (!canAccessBranch(req, exam.class.branchId)) { sendError(res, "Exam not found", 404); return; }

    const schedules = await prisma.examSchedule.findMany({
      where: { examId },
      include: { subject: { select: { id: true, name: true } } },
      orderBy: [{ examDate: "asc" }, { startTime: "asc" }],
    });

    const summaries = await Promise.all(
      schedules.map(async (s) => {
        const counts = await prisma.examAttendance.groupBy({ by: ["status"], where: { examScheduleId: s.id }, _count: { _all: true } });
        const byStatus: Record<string, number> = { PRESENT: 0, ABSENT: 0, UNFAIR_MEANS: 0, LATE: 0 };
        for (const c of counts) byStatus[c.status] = c._count._all;
        return {
          examScheduleId: s.id,
          subject: s.subject.name,
          examDate: s.examDate,
          ...byStatus,
          totalMarked: counts.reduce((sum, c) => sum + c._count._all, 0),
        };
      })
    );

    sendSuccess(res, summaries, "Exam attendance summary fetched");
  } catch (error) { sendError(res, "Failed to fetch exam attendance summary", 500, (error as Error).message); }
};
