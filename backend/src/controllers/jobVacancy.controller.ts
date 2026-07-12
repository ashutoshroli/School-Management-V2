import { Request, Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError, sendPaginated } from "../utils/response";
import { resolveBranchId, resolveEffectiveBranchId, canAccessBranch } from "../utils/branchScope";

/**
 * Job Vacancy / recruitment - mirrors AdmissionInquiry's "public
 * submit, staff reviews" shape exactly: JobVacancy is staff-managed,
 * JobApplication is the public (no-auth) write surface. Neither ever
 * creates a Staff/User record - a real hire still goes through the
 * existing (authenticated) createStaff flow.
 */

/**
 * GET /api/public/jobs
 * PUBLIC - only currently-active, not-yet-closed vacancies.
 */
export const getPublicJobVacancies = async (req: Request, res: Response): Promise<void> => {
  try {
    const branchId = req.query.branchId as string | undefined;
    const now = new Date();

    const jobs = await prisma.jobVacancy.findMany({
      where: {
        isActive: true,
        ...(branchId && { branchId }),
        OR: [{ closingDate: null }, { closingDate: { gte: now } }],
      },
      select: {
        id: true, title: true, department: true, description: true, qualifications: true,
        postedAt: true, closingDate: true, branch: { select: { name: true, city: true } },
      },
      orderBy: { postedAt: "desc" },
    });

    sendSuccess(res, jobs, "Job vacancies fetched");
  } catch (error) { sendError(res, "Failed to fetch job vacancies", 500, (error as Error).message); }
};

/**
 * POST /api/public/jobs/:id/apply
 * PUBLIC - applicant submits name/email/phone/resume/cover note
 * against one open vacancy.
 */
export const applyToJobVacancy = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { applicantName, email, phone, resumeUrl, coverNote } = req.body;

    const job = await prisma.jobVacancy.findUnique({ where: { id } });
    if (!job || !job.isActive) {
      sendError(res, "This job vacancy is not open for applications", 404);
      return;
    }
    if (job.closingDate && job.closingDate < new Date()) {
      sendError(res, "The application window for this vacancy has closed", 400);
      return;
    }

    const application = await prisma.jobApplication.create({
      data: { jobVacancyId: id, applicantName, email, phone, resumeUrl, coverNote },
    });

    sendSuccess(res, { id: application.id }, "Application submitted successfully. We'll be in touch if shortlisted.", 201);
  } catch (error) { sendError(res, "Failed to submit application", 500, (error as Error).message); }
};

/**
 * POST /api/hr/jobs
 * Staff-only - create a new vacancy posting.
 */
export const createJobVacancy = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { title, department, description, qualifications, closingDate } = req.body;
    const branchId = resolveEffectiveBranchId(req, req.body.branchId);
    if (!branchId) { sendError(res, "Branch ID could not be resolved - please select a branch", 400); return; }
    if (!canAccessBranch(req, branchId)) { sendError(res, "Access denied: branch mismatch", 403); return; }

    const job = await prisma.jobVacancy.create({
      data: {
        branchId, title, department, description, qualifications,
        closingDate: closingDate ? new Date(closingDate) : null,
        postedBy: req.user!.userId,
      },
    });
    sendSuccess(res, job, "Job vacancy posted", 201);
  } catch (error) { sendError(res, "Failed to create job vacancy", 500, (error as Error).message); }
};

/**
 * GET /api/hr/jobs
 * Staff-only - every vacancy for the caller's branch, including
 * inactive/closed ones (unlike the public list).
 */
export const getJobVacancies = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    const jobs = await prisma.jobVacancy.findMany({
      where: { branchId },
      include: { _count: { select: { applications: true } } },
      orderBy: { postedAt: "desc" },
    });
    sendSuccess(res, jobs, "Job vacancies fetched");
  } catch (error) { sendError(res, "Failed to fetch job vacancies", 500, (error as Error).message); }
};

/**
 * PUT /api/hr/jobs/:id
 * Staff-only - edit a vacancy (including toggling isActive to
 * open/close applications).
 */
export const updateJobVacancy = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { title, department, description, qualifications, closingDate, isActive } = req.body;

    const job = await prisma.jobVacancy.findUnique({ where: { id } });
    if (!job) { sendError(res, "Job vacancy not found", 404); return; }
    if (!canAccessBranch(req, job.branchId)) { sendError(res, "Job vacancy not found", 404); return; }

    const updated = await prisma.jobVacancy.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(department !== undefined && { department }),
        ...(description !== undefined && { description }),
        ...(qualifications !== undefined && { qualifications }),
        ...(closingDate !== undefined && { closingDate: closingDate ? new Date(closingDate) : null }),
        ...(isActive !== undefined && { isActive }),
      },
    });
    sendSuccess(res, updated, "Job vacancy updated");
  } catch (error) { sendError(res, "Failed to update job vacancy", 500, (error as Error).message); }
};

/**
 * DELETE /api/hr/jobs/:id
 * Staff-only. Blocked once any application has been submitted against
 * it - close it (isActive: false) instead if applications should stop
 * showing publicly; real applicant submissions are never silently
 * dropped by a delete.
 */
export const deleteJobVacancy = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const job = await prisma.jobVacancy.findUnique({ where: { id } });
    if (!job) { sendError(res, "Job vacancy not found", 404); return; }
    if (!canAccessBranch(req, job.branchId)) { sendError(res, "Job vacancy not found", 404); return; }

    const appCount = await prisma.jobApplication.count({ where: { jobVacancyId: id } });
    if (appCount > 0) {
      sendError(res, `Cannot delete: ${appCount} application(s) have already been submitted. Close the vacancy instead.`, 400);
      return;
    }

    await prisma.jobVacancy.delete({ where: { id } });
    sendSuccess(res, null, "Job vacancy deleted");
  } catch (error) { sendError(res, "Failed to delete job vacancy", 500, (error as Error).message); }
};

/**
 * GET /api/hr/jobs/:id/applications
 * Staff-only - review applications for one vacancy.
 */
export const getJobApplications = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 25;
    const skip = (page - 1) * limit;

    const job = await prisma.jobVacancy.findUnique({ where: { id } });
    if (!job) { sendError(res, "Job vacancy not found", 404); return; }
    if (!canAccessBranch(req, job.branchId)) { sendError(res, "Job vacancy not found", 404); return; }

    const status = req.query.status as string | undefined;
    const where: any = { jobVacancyId: id };
    if (status) where.status = status;

    const [applications, total] = await Promise.all([
      prisma.jobApplication.findMany({ where, skip, take: limit, orderBy: { createdAt: "desc" } }),
      prisma.jobApplication.count({ where }),
    ]);

    sendPaginated(res, applications, total, page, limit, "Applications fetched");
  } catch (error) { sendError(res, "Failed to fetch applications", 500, (error as Error).message); }
};

/**
 * PATCH /api/hr/jobs/applications/:id/status
 * Staff-only - move an application through the review pipeline
 * (NEW -> SHORTLISTED/REJECTED -> HIRED).
 */
export const updateJobApplicationStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, reviewNotes } = req.body;

    const application = await prisma.jobApplication.findUnique({ where: { id }, include: { jobVacancy: true } });
    if (!application) { sendError(res, "Application not found", 404); return; }
    if (!canAccessBranch(req, application.jobVacancy.branchId)) { sendError(res, "Application not found", 404); return; }

    const updated = await prisma.jobApplication.update({
      where: { id },
      data: { status, reviewNotes, reviewedBy: req.user!.userId },
    });
    sendSuccess(res, updated, "Application updated");
  } catch (error) { sendError(res, "Failed to update application", 500, (error as Error).message); }
};
