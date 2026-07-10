import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";

/**
 * Create homework
 */
export const createHomework = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { subjectId, classId, sectionId, title, description, attachmentUrl, dueDate } = req.body;

    const homework = await prisma.homework.create({
      data: { subjectId, classId, sectionId, title, description, attachmentUrl, dueDate: new Date(dueDate), assignedBy: req.user!.userId },
    });
    sendSuccess(res, homework, "Homework created", 201);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Get homeworks (filtered by class/subject/teacher)
 */
export const getHomeworks = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const classId = req.query.classId as string;
    const subjectId = req.query.subjectId as string;
    const sectionId = req.query.sectionId as string;

    const where: any = {};
    if (classId) where.classId = classId;
    if (subjectId) where.subjectId = subjectId;
    if (sectionId) where.sectionId = sectionId;

    const homeworks = await prisma.homework.findMany({
      where, orderBy: { createdAt: "desc" },
      include: { subject: { select: { name: true } }, submissions: { select: { id: true } } },
    });

    const enriched = homeworks.map(h => ({ ...h, submissionCount: h.submissions.length }));
    sendSuccess(res, enriched, "Homeworks fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Submit homework (student)
 */
export const submitHomework = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { homeworkId, content, fileUrl } = req.body;
    const userId = req.user!.userId;

    const student = await prisma.student.findUnique({ where: { userId } });
    if (!student) { sendError(res, "Student not found", 404); return; }

    const submission = await prisma.homeworkSubmission.upsert({
      where: { homeworkId_studentId: { homeworkId, studentId: student.id } },
      update: { content, fileUrl, submittedAt: new Date() },
      create: { homeworkId, studentId: student.id, content, fileUrl },
    });
    sendSuccess(res, submission, "Homework submitted");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Get submissions for a homework (teacher view)
 */
export const getSubmissions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { homeworkId } = req.params;

    const submissions = await prisma.homeworkSubmission.findMany({
      where: { homeworkId },
      include: { student: { include: { user: { select: { name: true } } } } },
      orderBy: { submittedAt: "desc" },
    });
    sendSuccess(res, submissions, "Submissions fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};
