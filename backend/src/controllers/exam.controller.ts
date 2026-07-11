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
 * Update exam metadata (name/type/dates). Class/academic year are
 * intentionally NOT editable here - changing them after marks may
 * already have been entered against the original class/year would
 * silently detach those Mark rows from the exam they were recorded
 * for; delete and recreate the exam instead if that's genuinely needed.
 */
export const updateExam = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, type, startDate, endDate } = req.body;

    const exam = await prisma.exam.findUnique({ where: { id } });
    if (!exam) { sendError(res, "Exam not found", 404); return; }

    const updated = await prisma.exam.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(type !== undefined && { type }),
        ...(startDate !== undefined && { startDate: startDate ? new Date(startDate) : null }),
        ...(endDate !== undefined && { endDate: endDate ? new Date(endDate) : null }),
      },
    });
    sendSuccess(res, updated, "Exam updated");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Delete an exam. Blocked once any marks have been recorded against
 * it, or once results have been published - both are real academic
 * history that must never silently disappear. An exam with no marks
 * yet (e.g. created by mistake, wrong class) can be removed freely.
 */
export const deleteExam = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const exam = await prisma.exam.findUnique({ where: { id } });
    if (!exam) { sendError(res, "Exam not found", 404); return; }

    if (exam.isPublished) {
      sendError(res, "Cannot delete a published exam - unpublish it first if you're certain", 400);
      return;
    }

    const markCount = await prisma.mark.count({ where: { examId: id } });
    if (markCount > 0) {
      sendError(res, `Cannot delete: ${markCount} mark(s) have already been recorded for this exam.`, 400);
      return;
    }

    await prisma.exam.delete({ where: { id } });
    sendSuccess(res, null, "Exam deleted");
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
 * Auto grade lookup: prefer the admin-configured GradeSystem bands
 * (see gradeSystem.controller.ts) if any exist, matching the
 * percentage against each band's [minMarks, maxMarks] range
 * inclusively. Falls back to the original hardcoded A+/A/B+/.../F
 * scale when no bands have been configured yet, so existing
 * deployments/tests that never touch Grade System settings keep their
 * exact previous behavior.
 */
const lookupGrade = (pct: number, bands: { minMarks: any; maxMarks: any; grade: string }[]): string => {
  if (bands.length > 0) {
    const match = bands.find((b) => pct >= Number(b.minMarks) && pct <= Number(b.maxMarks));
    if (match) return match.grade;
  }
  if (pct >= 90) return "A+";
  if (pct >= 80) return "A";
  if (pct >= 70) return "B+";
  if (pct >= 60) return "B";
  if (pct >= 50) return "C";
  if (pct >= 40) return "D";
  if (pct >= 33) return "E";
  return "F";
};

/**
 * Enter/update marks (bulk for a subject+exam)
 */
export const enterMarks = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { examId, subjectId, marks } = req.body;
    // marks: [{studentId, maxMarks, obtainedMarks}]

    // Fetch the configured grade bands once for the whole batch,
    // rather than re-querying per student (this loop can be dozens of
    // students for a single class).
    const gradeBands = await prisma.gradeSystem.findMany({ orderBy: { minMarks: "asc" } });

    let saved = 0;
    for (const m of marks) {
      const pct = (m.obtainedMarks / m.maxMarks) * 100;
      const grade = lookupGrade(pct, gradeBands);

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
