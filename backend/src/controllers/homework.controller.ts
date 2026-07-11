import { Response } from "express";
import { UserRole } from "@prisma/client";
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
 * Update homework (edit title/description/due date/attachment).
 * Only the assigning teacher or a branch admin may edit it.
 */
export const updateHomework = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { title, description, attachmentUrl, dueDate } = req.body;

    const homework = await prisma.homework.findUnique({ where: { id } });
    if (!homework) { sendError(res, "Homework not found", 404); return; }

    const isOwner = homework.assignedBy === req.user!.userId;
    const isAdmin = req.user!.role === UserRole.SUPER_ADMIN || req.user!.role === UserRole.BRANCH_ADMIN;
    if (!isOwner && !isAdmin) {
      sendError(res, "Only the assigning teacher or an admin can edit this homework", 403);
      return;
    }

    const updated = await prisma.homework.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(attachmentUrl !== undefined && { attachmentUrl }),
        ...(dueDate !== undefined && { dueDate: new Date(dueDate) }),
      },
    });
    sendSuccess(res, updated, "Homework updated");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Delete homework. Cascades its submissions too - a homework
 * assignment being removed (e.g. posted by mistake, wrong class) is
 * meant to remove the whole thing, not leave orphaned submissions with
 * no parent record.
 */
export const deleteHomework = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const homework = await prisma.homework.findUnique({ where: { id } });
    if (!homework) { sendError(res, "Homework not found", 404); return; }

    const isOwner = homework.assignedBy === req.user!.userId;
    const isAdmin = req.user!.role === UserRole.SUPER_ADMIN || req.user!.role === UserRole.BRANCH_ADMIN;
    if (!isOwner && !isAdmin) {
      sendError(res, "Only the assigning teacher or an admin can delete this homework", 403);
      return;
    }

    await prisma.$transaction([
      prisma.homeworkSubmission.deleteMany({ where: { homeworkId: id } }),
      prisma.homework.delete({ where: { id } }),
    ]);
    sendSuccess(res, null, "Homework deleted");
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
