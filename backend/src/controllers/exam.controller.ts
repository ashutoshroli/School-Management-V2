import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";

/**
 * Create exam
 */
export const createExam = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { academicYearId, classId, name, type, startDate, endDate } = req.body;

    // BUG FIX: Exam.academicYearId/classId are required (non-nullable)
    // relations, but the frontend's "Academic Year" field wasn't marked
    // required - leaving it blank sent "" and Prisma rejected it as an
    // invalid foreign key, surfacing as a generic "Failed" 500 with no
    // hint of which field was the problem. Now marked required in the
    // UI (see exams/page.tsx) with a clear 400 here as a server-side
    // backstop.
    if (!academicYearId || !classId || !name) {
      sendError(res, "academicYearId, classId, and name are required", 400);
      return;
    }

    const exam = await prisma.exam.create({
      data: { academicYearId, classId, name, type, startDate: startDate ? new Date(startDate) : null, endDate: endDate ? new Date(endDate) : null },
    });
    sendSuccess(res, exam, "Exam created", 201);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Get exams for a class/year
 */
export const getExams = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const classId = req.query.classId as string;
    const academicYearId = req.query.academicYearId as string;

    const where: any = {};
    if (classId) where.classId = classId;
    if (academicYearId) where.academicYearId = academicYearId;

    const exams = await prisma.exam.findMany({
      where, orderBy: { createdAt: "desc" },
      include: { class: { select: { name: true } }, academicYear: { select: { name: true } } },
    });
    sendSuccess(res, exams, "Exams fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Enter/update marks (bulk for a subject+exam)
 */
export const enterMarks = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { examId, subjectId, marks } = req.body;
    // marks: [{studentId, maxMarks, obtainedMarks}]

    let saved = 0;
    for (const m of marks) {
      // Auto grade
      const pct = (m.obtainedMarks / m.maxMarks) * 100;
      let grade = "F";
      if (pct >= 90) grade = "A+";
      else if (pct >= 80) grade = "A";
      else if (pct >= 70) grade = "B+";
      else if (pct >= 60) grade = "B";
      else if (pct >= 50) grade = "C";
      else if (pct >= 40) grade = "D";
      else if (pct >= 33) grade = "E";

      await prisma.mark.upsert({
        where: { examId_studentId_subjectId: { examId, studentId: m.studentId, subjectId } },
        update: { maxMarks: m.maxMarks, obtainedMarks: m.obtainedMarks, grade },
        create: { examId, studentId: m.studentId, subjectId, maxMarks: m.maxMarks, obtainedMarks: m.obtainedMarks, grade },
      });
      saved++;
    }
    sendSuccess(res, { saved }, `${saved} marks saved`);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Get results for an exam (all students)
 */
export const getExamResults = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { examId } = req.params;

    const marks = await prisma.mark.findMany({
      where: { examId },
      include: {
        student: { include: { user: { select: { name: true } } } },
        subject: { select: { name: true, code: true } },
      },
      orderBy: [{ student: { user: { name: "asc" } } }, { subject: { name: "asc" } }],
    });

    // Group by student
    const grouped: Record<string, any> = {};
    for (const m of marks) {
      if (!grouped[m.studentId]) {
        grouped[m.studentId] = { student: m.student.user.name, studentId: m.studentId, subjects: [], total: 0, maxTotal: 0 };
      }
      grouped[m.studentId].subjects.push({ subject: m.subject.name, max: m.maxMarks, obtained: m.obtainedMarks, grade: m.grade });
      grouped[m.studentId].total += Number(m.obtainedMarks);
      grouped[m.studentId].maxTotal += Number(m.maxMarks);
    }

    const results = Object.values(grouped).map((r: any) => ({
      ...r, percentage: r.maxTotal > 0 ? Math.round((r.total / r.maxTotal) * 100) : 0,
    })).sort((a: any, b: any) => b.percentage - a.percentage);

    // Add rank
    results.forEach((r: any, i: number) => { r.rank = i + 1; });

    sendSuccess(res, results, "Results fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Publish/unpublish exam results
 */
export const togglePublish = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const exam = await prisma.exam.findUnique({ where: { id } });
    if (!exam) { sendError(res, "Not found", 404); return; }
    const updated = await prisma.exam.update({ where: { id }, data: { isPublished: !exam.isPublished } });
    sendSuccess(res, updated, `Exam ${updated.isPublished ? "published" : "unpublished"}`);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};
