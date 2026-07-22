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

/**
 * Grade a homework submission with the 1-5 rating scale (spec Section
 * 10 - "Grading: Subject Teacher only, after the deadline - 1-5
 * rating with remarks"). Restricted to the SUBJECT teacher (a
 * SubjectTeacher row for this homework's subject+class, school-wide
 * default OR class-specific - same access shape as
 * canTeacherTeachSubjectForClass) and only once the homework's
 * dueDate has passed; ADMIN roles are unrestricted on both counts.
 */
export const gradeHomeworkSubmission = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params; // HomeworkSubmission id
    const { rating, remarks } = req.body;

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      sendError(res, "rating must be a whole number from 1 to 5", 400);
      return;
    }

    const submission = await prisma.homeworkSubmission.findUnique({
      where: { id },
      include: { homework: true },
    });
    if (!submission) { sendError(res, "Submission not found", 404); return; }

    const cls = await prisma.class.findUnique({ where: { id: submission.homework.classId }, select: { branchId: true } });
    if (!cls || !canAccessBranch(req, cls.branchId)) { sendError(res, "Submission not found", 404); return; }

    if (req.user!.role === UserRole.TEACHER) {
      const staff = await prisma.staff.findUnique({ where: { userId: req.user!.userId }, select: { id: true } });
      const isAssigned = staff && await prisma.subjectTeacher.count({
        where: { staffId: staff.id, subjectId: submission.homework.subjectId, OR: [{ classId: submission.homework.classId }, { classId: null }] },
      }) > 0;
      if (!isAssigned) {
        sendError(res, "Only the subject teacher for this homework may grade it", 403);
        return;
      }
    }

    if (new Date() < new Date(submission.homework.dueDate)) {
      sendError(res, "Grading is only allowed after the homework's due date has passed", 400);
      return;
    }

    const updated = await prisma.homeworkSubmission.update({
      where: { id },
      data: { rating, remarks, ratedBy: req.user!.userId, ratedAt: new Date() },
    });
    sendSuccess(res, updated, "Submission graded");
  } catch (error) { sendError(res, "Failed to grade submission", 500, (error as Error).message); }
};

/**
 * Student/Parent raises a homework recheck request (spec Section 10) -
 * always starts at CLASS_TEACHER level. Escalation to PRINCIPAL/
 * DIRECTOR happens explicitly via escalateRecheckRequest below (driven
 * by the configurable per-teacher threshold), not automatically here.
 */
export const raiseRecheckRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { homeworkSubmissionId, reason } = req.body;

    const submission = await prisma.homeworkSubmission.findUnique({ where: { id: homeworkSubmissionId } });
    if (!submission) { sendError(res, "Submission not found", 404); return; }

    if (req.user!.role === UserRole.STUDENT) {
      const student = await prisma.student.findUnique({ where: { userId: req.user!.userId }, select: { id: true } });
      if (!student || student.id !== submission.studentId) {
        sendError(res, "You may only raise a recheck request for your own submission", 403);
        return;
      }
    }

    const request = await prisma.homeworkRecheckRequest.create({
      data: { homeworkSubmissionId, studentId: submission.studentId, reason, currentLevel: "CLASS_TEACHER", status: "PENDING" },
    });
    sendSuccess(res, request, "Recheck request submitted to the Class Teacher", 201);
  } catch (error) { sendError(res, "Failed to raise recheck request", 500, (error as Error).message); }
};

export const getRecheckRequests = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const level = req.query.level as string | undefined;
    const status = req.query.status as string | undefined;

    const where: any = {};
    if (level) where.currentLevel = level;
    if (status) where.status = status;

    const requests = await prisma.homeworkRecheckRequest.findMany({
      where,
      include: {
        student: { include: { user: { select: { name: true } } } },
        submission: { include: { homework: { select: { title: true, classId: true, assignedBy: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });
    sendSuccess(res, requests, "Recheck requests fetched");
  } catch (error) { sendError(res, "Failed to fetch recheck requests", 500, (error as Error).message); }
};

/**
 * Class Teacher resolves a recheck request at their level, OR escalates
 * it onward (spec Section 10 - "if that teacher's recheck-request
 * count exceeds a max threshold set by Super Admin, escalate to
 * Principal; beyond that, Director"). Escalation eligibility is
 * computed here (this class teacher's total recheck-request count
 * against RecheckEscalationConfig), not automatically enforced - a
 * class teacher can still resolve a request directly even past the
 * threshold; escalate is an explicit action for when they instead want
 * to push it up the chain.
 */
export const resolveOrEscalateRecheckRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { action, remarks } = req.body; // "RESOLVE" | "ESCALATE"

    const request = await prisma.homeworkRecheckRequest.findUnique({
      where: { id },
      include: { submission: { include: { homework: true } } },
    });
    if (!request) { sendError(res, "Recheck request not found", 404); return; }
    if (request.status !== "PENDING") { sendError(res, "This request has already been resolved", 400); return; }

    if (action === "RESOLVE") {
      const fieldByLevel = {
        CLASS_TEACHER: "classTeacherRemarks",
        PRINCIPAL: "principalRemarks",
        DIRECTOR: "directorRemarks",
      } as const;
      const updated = await prisma.homeworkRecheckRequest.update({
        where: { id },
        data: { status: "RESOLVED", resolvedAt: new Date(), [fieldByLevel[request.currentLevel]]: remarks },
      });
      sendSuccess(res, updated, "Recheck request resolved");
      return;
    }

    // ESCALATE: CLASS_TEACHER -> PRINCIPAL -> DIRECTOR. Only allowed if
    // this teacher's total recheck-request count exceeds the
    // Super-Admin-configured threshold (absence of a config row means
    // escalation is not yet enabled at all).
    if (request.currentLevel === "DIRECTOR") {
      sendError(res, "This request is already at the final escalation level", 400);
      return;
    }

    if (request.currentLevel === "CLASS_TEACHER") {
      const config = await prisma.recheckEscalationConfig.findFirst();
      if (!config) {
        sendError(res, "Escalation is not configured yet - ask a Super Admin to set the threshold first", 400);
        return;
      }
      const teacherId = request.submission.homework.assignedBy;
      const requestCount = await prisma.homeworkRecheckRequest.count({
        where: { submission: { homework: { assignedBy: teacherId } } },
      });
      if (requestCount <= config.maxRequestsPerTeacherBeforeEscalation) {
        sendError(res, `This teacher's recheck-request count (${requestCount}) has not exceeded the configured threshold (${config.maxRequestsPerTeacherBeforeEscalation})`, 400);
        return;
      }
    }

    const nextLevel = request.currentLevel === "CLASS_TEACHER" ? "PRINCIPAL" : "DIRECTOR";
    const updated = await prisma.homeworkRecheckRequest.update({
      where: { id },
      data: { currentLevel: nextLevel, classTeacherRemarks: request.currentLevel === "CLASS_TEACHER" ? remarks : request.classTeacherRemarks },
    });
    sendSuccess(res, updated, `Escalated to ${nextLevel}`);
  } catch (error) { sendError(res, "Failed to resolve/escalate recheck request", 500, (error as Error).message); }
};

/**
 * Super-Admin-configurable escalation threshold (spec Section 10).
 * Single-row upsert, same convention as other system-wide config
 * models in this codebase (GradeSystem, LeaveType).
 */
export const upsertRecheckEscalationConfig = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { maxRequestsPerTeacherBeforeEscalation } = req.body;
    const existing = await prisma.recheckEscalationConfig.findFirst();
    const config = existing
      ? await prisma.recheckEscalationConfig.update({
          where: { id: existing.id },
          data: { maxRequestsPerTeacherBeforeEscalation, updatedBy: req.user!.userId },
        })
      : await prisma.recheckEscalationConfig.create({
          data: { maxRequestsPerTeacherBeforeEscalation, updatedBy: req.user!.userId },
        });
    sendSuccess(res, config, "Recheck escalation threshold saved");
  } catch (error) { sendError(res, "Failed to save escalation config", 500, (error as Error).message); }
};

export const getRecheckEscalationConfig = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const config = await prisma.recheckEscalationConfig.findFirst();
    sendSuccess(res, config, "Recheck escalation config fetched");
  } catch (error) { sendError(res, "Failed to fetch escalation config", 500, (error as Error).message); }
};
