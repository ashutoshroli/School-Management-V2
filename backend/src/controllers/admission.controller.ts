import { Response, Request } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError, sendPaginated } from "../utils/response";
import { resolveBranchId, canAccessBranch } from "../utils/branchScope";
import { notify } from "../services/notification.service";

/**
 * POST /api/admission/inquiries
 * PUBLIC, no authentication - this is the "apply online" form on the
 * school's public website. Deliberately does NOT create a User/Student
 * account itself (see the AdmissionInquiry model's doc comment in
 * schema.prisma) - it just records the inquiry for staff to follow up
 * on and manually convert into a real admission via the existing
 * (authenticated, staff-only) createStudent flow.
 */
/**
 * GET /api/admission/branches
 * PUBLIC - a minimal branch list (id/name/city only, no addresses,
 * contact info, or counts) so the public admission form can offer a
 * branch picker without exposing the full authenticated /branches
 * endpoint's data to anonymous visitors.
 */
export const getPublicBranchList = async (_req: Request, res: Response): Promise<void> => {
  try {
    const branches = await prisma.branch.findMany({
      where: { isActive: true },
      select: { id: true, name: true, city: true },
      orderBy: { name: "asc" },
    });
    sendSuccess(res, branches, "Branches fetched");
  } catch (error) {
    sendError(res, "Failed to fetch branches", 500, (error as Error).message);
  }
};

export const createAdmissionInquiry = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      branchId, studentName, dateOfBirth, gender, classAppliedFor,
      parentName, parentEmail, parentPhone, address, previousSchool, message,
    } = req.body;

    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true, isActive: true } });
    if (!branch || !branch.isActive) {
      sendError(res, "Invalid branch", 400);
      return;
    }

    const inquiry = await prisma.admissionInquiry.create({
      data: {
        branchId,
        studentName,
        dateOfBirth: new Date(dateOfBirth),
        gender,
        classAppliedFor,
        parentName,
        parentEmail,
        parentPhone,
        address,
        previousSchool,
        message,
      },
    });

    // Notify branch admins so they know a new inquiry needs follow-up.
    // Best-effort - a failed notification should never fail the public
    // form submission itself.
    notifyBranchAdminsOfInquiry(branchId, studentName).catch((err) =>
      console.error("Failed to notify branch admins of new admission inquiry:", err)
    );

    sendSuccess(res, { id: inquiry.id }, "Thank you! Your inquiry has been received. Our admissions team will contact you shortly.", 201);
  } catch (error) {
    sendError(res, "Failed to submit inquiry", 500, (error as Error).message);
  }
};

async function notifyBranchAdminsOfInquiry(branchId: string, studentName: string) {
  // Branch Admin isn't directly linked to a branch via a dedicated
  // model - the closest available signal is a Staff row with
  // designation-agnostic branch scoping, so we notify any active staff
  // whose underlying User has role BRANCH_ADMIN in this branch.
  const admins = await prisma.staff.findMany({
    where: { branchId, isActive: true, user: { role: "BRANCH_ADMIN" } },
    select: { userId: true },
  });

  await Promise.all(
    admins.map((admin) =>
      notify({
        userId: admin.userId,
        type: "GENERAL",
        title: "New Admission Inquiry",
        body: `A new admission inquiry was submitted for ${studentName}. Please review it in the Admissions section.`,
      })
    )
  );
}

/**
 * GET /api/admission/inquiries
 * Staff-only (mounted behind authenticate+authorize) - lists inquiries
 * for the caller's branch (or all branches for SUPER_ADMIN).
 */
export const getAdmissionInquiries = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 25;
    const skip = (page - 1) * limit;
    const branchId = resolveBranchId(req);
    const status = req.query.status as string | undefined;

    const where: any = {};
    if (branchId) where.branchId = branchId;
    if (status) where.status = status;

    const [inquiries, total] = await Promise.all([
      prisma.admissionInquiry.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: { branch: { select: { name: true } } },
      }),
      prisma.admissionInquiry.count({ where }),
    ]);

    sendPaginated(res, inquiries, total, page, limit, "Admission inquiries fetched");
  } catch (error) {
    sendError(res, "Failed to fetch inquiries", 500, (error as Error).message);
  }
};

/**
 * PATCH /api/admission/inquiries/:id/status
 * Staff-only - move an inquiry through the follow-up pipeline
 * (NEW -> CONTACTED -> ADMITTED/REJECTED). Does not itself create the
 * Student record even when marked ADMITTED - staff still use the
 * regular admission form (createStudent) for that, using this inquiry
 * as reference information.
 */
export const updateAdmissionInquiryStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, reviewNotes } = req.body;

    const inquiry = await prisma.admissionInquiry.findUnique({ where: { id } });
    if (!inquiry) {
      sendError(res, "Inquiry not found", 404);
      return;
    }

    if (!canAccessBranch(req, inquiry.branchId)) {
      sendError(res, "Inquiry not found", 404);
      return;
    }

    const updated = await prisma.admissionInquiry.update({
      where: { id },
      data: { status, reviewNotes, reviewedBy: req.user!.userId },
    });

    sendSuccess(res, updated, "Inquiry updated");
  } catch (error) {
    sendError(res, "Failed to update inquiry", 500, (error as Error).message);
  }
};
