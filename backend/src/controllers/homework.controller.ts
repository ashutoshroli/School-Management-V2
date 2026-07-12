import { Response } from "express";
import { UserRole } from "@prisma/client";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { canAccessBranch, resolveBranchId } from "../utils/branchScope";

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
 * Get single homework detail, with its full submission list (student
 * name + submitted-at + grade) - Homework has no branchId of its own,
 * so branch-scoping is checked via its Class (like getExamById follows
 * for Exam), a relation not otherwise loaded by getHomeworks's list view.
 */
export const getHomeworkById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const homework = await prisma.homework.findUnique({
      where: { id },
      include: {
        subject: { select: { id: true, name: true, code: true } },
        submissions: {
          include: { student: { include: { user: { select: { name: true } } } } },
          orderBy: { submittedAt: "desc" },
        },
      },
    });
    if (!homework) { sendError(res, "Homework not found", 404); return; }

    const cls = await prisma.class.findUnique({ where: { id: homework.classId }, select: { branchId: true, name: true } });
    if (!cls || !canAccessBranch(req, cls.branchId)) { sendError(res, "Homework not found", 404); return; }

    sendSuccess(res, { ...homework, class: cls }, "Homework fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Get homeworks (filtered by class/subject/teacher)
 *
 * SECURITY FIX: this previously had NO branch scoping at all when
 * called with no classId (e.g. the admin Homework list page's default
 * "show everything" view) - any authenticated user (Teacher, Branch
 * Admin, even a Student/Parent hitting this endpoint directly) could
 * see homework assigned in EVERY branch, not just their own. Homework
 * has no branchId column of its own (it only has a classId), so this
 * resolves the branch through Class the same way getExams does for
 * Exam - a classId already scopes to one specific branch on its own
 * (a class can't span branches), so no additional filter is needed
 * when one is explicitly provided; otherwise fall back to the
 * caller's own branch (or every branch for a Super Admin with no
 * session branch at all - matches every other unscoped list
 * endpoint's convention in this codebase).
 */
export const getHomeworks = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const classId = req.query.classId as string;
    const subjectId = req.query.subjectId as string;
    const sectionId = req.query.sectionId as string;

    const where: any = {};
    if (classId) {
      where.classId = classId;
    } else {
      const branchId = resolveBranchId(req);
      if (branchId) where.class = { branchId };
    }
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
