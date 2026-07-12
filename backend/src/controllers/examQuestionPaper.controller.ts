import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { canAccessBranch } from "../utils/branchScope";
import { canTeacherTeachSubjectForClass } from "../utils/teacherAccess";
import { storage } from "../services/storage.service";

/**
 * Exam question paper upload (PDF/DOCX), scoped to the specific exam
 * subject sitting (ExamSchedule). A TEACHER may only upload for a
 * subject+class they actually teach (see
 * canTeacherTeachSubjectForClass) - not "any teacher, any subject".
 * ADMIN roles are unrestricted (exam coordinators typically manage
 * papers across the whole school).
 */

/**
 * POST /api/academics/exams/question-papers
 * multipart: field "file" (PDF or DOCX, see uploadDocument's mimetype
 * allowlist - DOCUMENT_MIME_TYPES already includes application/pdf;
 * DOCX support is added alongside this feature, see middleware/upload.ts),
 * body: examScheduleId, sectionId (optional).
 */
export const uploadExamQuestionPaper = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { examScheduleId, sectionId } = req.body;

    if (!req.file) {
      sendError(res, "No file uploaded (expected multipart field 'file')", 400);
      return;
    }
    if (!examScheduleId) {
      sendError(res, "examScheduleId is required", 400);
      return;
    }

    const schedule = await prisma.examSchedule.findUnique({
      where: { id: examScheduleId },
      include: { exam: { include: { class: { select: { id: true, branchId: true } } } } },
    });
    if (!schedule) { sendError(res, "Exam schedule entry not found", 404); return; }
    if (!canAccessBranch(req, schedule.exam.class.branchId)) { sendError(res, "Exam schedule entry not found", 404); return; }

    // SECURITY: a TEACHER may only upload a paper for a subject+class
    // they're actually assigned to teach - see this function's doc
    // comment. ADMIN roles pass through unrestricted.
    const allowed = await canTeacherTeachSubjectForClass(req, schedule.subjectId, schedule.exam.classId);
    if (!allowed) {
      sendError(res, "You are not assigned to teach this subject for this class", 403);
      return;
    }

    if (sectionId) {
      const section = await prisma.section.findUnique({ where: { id: sectionId }, select: { classId: true } });
      if (!section || section.classId !== schedule.exam.classId) {
        sendError(res, "Section does not belong to this exam's class", 400);
        return;
      }
    }

    const { url } = await storage.save(req.file.buffer, req.file.originalname, `exam-question-papers/${examScheduleId}`);

    const paper = await prisma.examQuestionPaper.create({
      data: {
        examScheduleId,
        sectionId: sectionId || null,
        fileUrl: url,
        fileName: req.file.originalname,
        uploadedBy: req.user!.userId,
      },
    });

    sendSuccess(res, paper, "Question paper uploaded", 201);
  } catch (error) {
    sendError(res, "Failed to upload question paper", 500, (error as Error).message);
  }
};

/**
 * GET /api/academics/exams/question-papers?examScheduleId=...
 * ADMIN roles see every paper for the schedule entry; a TEACHER only
 * sees their own uploads (papers set by other teachers for a different
 * subject/section aren't relevant to - and shouldn't be browsable by -
 * a teacher who isn't assigned to that subject).
 */
export const getExamQuestionPapers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const examScheduleId = req.query.examScheduleId as string;
    if (!examScheduleId) { sendError(res, "examScheduleId is required", 400); return; }

    const schedule = await prisma.examSchedule.findUnique({
      where: { id: examScheduleId },
      include: { exam: { include: { class: { select: { branchId: true } } } } },
    });
    if (!schedule) { sendError(res, "Exam schedule entry not found", 404); return; }
    if (!canAccessBranch(req, schedule.exam.class.branchId)) { sendError(res, "Exam schedule entry not found", 404); return; }

    const where: any = { examScheduleId };
    if (req.user!.role === "TEACHER") {
      where.uploadedBy = req.user!.userId;
    }

    const papers = await prisma.examQuestionPaper.findMany({
      where,
      include: { section: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
    sendSuccess(res, papers, "Question papers fetched");
  } catch (error) { sendError(res, "Failed to fetch question papers", 500, (error as Error).message); }
};

/**
 * DELETE /api/academics/exams/question-papers/:id
 * A TEACHER may only delete their own upload; ADMIN roles can delete
 * any paper for their branch.
 */
export const deleteExamQuestionPaper = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const paper = await prisma.examQuestionPaper.findUnique({
      where: { id },
      include: { examSchedule: { include: { exam: { include: { class: { select: { branchId: true } } } } } } },
    });
    if (!paper) { sendError(res, "Question paper not found", 404); return; }
    if (!canAccessBranch(req, paper.examSchedule.exam.class.branchId)) { sendError(res, "Question paper not found", 404); return; }
    if (req.user!.role === "TEACHER" && paper.uploadedBy !== req.user!.userId) {
      sendError(res, "You can only delete your own uploaded question papers", 403);
      return;
    }

    await prisma.examQuestionPaper.delete({ where: { id } });
    await storage.deleteByUrl(paper.fileUrl);

    sendSuccess(res, null, "Question paper deleted");
  } catch (error) { sendError(res, "Failed to delete question paper", 500, (error as Error).message); }
};
