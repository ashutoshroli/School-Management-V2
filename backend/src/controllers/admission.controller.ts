import { Response, Request } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError, sendPaginated } from "../utils/response";
import { resolveBranchId, canAccessBranch } from "../utils/branchScope";
import { notify } from "../services/notification.service";
import { startPdfResponse, sendPdfBuffer, drawHeader, drawFooter, drawKeyValueRow, drawQrCode, formatDate } from "../services/pdf.service";
import { renderTemplateToPdf } from "../services/templateRenderer.service";
import { getActiveDocumentTemplate } from "../services/documentTemplateLookup.service";

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
 * GET /api/admission/inquiries/:id/pdf
 * Streams a printable summary of one admission inquiry - staff-only
 * (same access level as viewing/updating the inquiry itself). Tries
 * the admin-uploaded ADMISSION_FORM DocumentTemplate first (see
 * templateRenderer.service.ts); falls back to a plain PDFKit layout
 * below when no usable template is available.
 */
export const getAdmissionInquiryPdf = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const inquiry = await prisma.admissionInquiry.findUnique({
      where: { id },
      include: { branch: { select: { name: true, address: true, city: true, state: true, pincode: true, phone: true } } },
    });
    if (!inquiry) {
      sendError(res, "Inquiry not found", 404);
      return;
    }

    if (!canAccessBranch(req, inquiry.branchId)) {
      sendError(res, "Inquiry not found", 404);
      return;
    }

    const filename = `admission-inquiry-${inquiry.id}.pdf`;
    const admissionFormTemplate = await getActiveDocumentTemplate("ADMISSION_FORM");
    const fromTemplate = await renderTemplateToPdf(admissionFormTemplate?.templateUrl, {
      studentName: inquiry.studentName,
      dateOfBirth: formatDate(inquiry.dateOfBirth),
      gender: inquiry.gender,
      classAppliedFor: inquiry.classAppliedFor,
      parentName: inquiry.parentName,
      parentEmail: inquiry.parentEmail,
      parentPhone: inquiry.parentPhone,
      address: inquiry.address || "",
      previousSchool: inquiry.previousSchool || "",
      branchName: inquiry.branch.name,
      branchAddress: [inquiry.branch.address, inquiry.branch.city, inquiry.branch.state, inquiry.branch.pincode].filter(Boolean).join(", "),
      branchPhone: inquiry.branch.phone || "",
    });
    if (fromTemplate) {
      sendPdfBuffer(res, filename, fromTemplate);
      return;
    }

    const doc = startPdfResponse(res, filename);
    drawHeader(doc, inquiry.branch.name, "Admission Inquiry Form");

    const leftX = doc.page.margins.left;
    let y = doc.y;
    drawKeyValueRow(doc, "Applicant Name", inquiry.studentName, leftX, y); y += 18;
    drawKeyValueRow(doc, "Date of Birth", formatDate(inquiry.dateOfBirth), leftX, y); y += 18;
    drawKeyValueRow(doc, "Gender", inquiry.gender, leftX, y); y += 18;
    drawKeyValueRow(doc, "Class Applied For", inquiry.classAppliedFor, leftX, y); y += 18;
    drawKeyValueRow(doc, "Parent/Guardian Name", inquiry.parentName, leftX, y); y += 18;
    drawKeyValueRow(doc, "Parent Email", inquiry.parentEmail, leftX, y); y += 18;
    drawKeyValueRow(doc, "Parent Phone", inquiry.parentPhone, leftX, y); y += 18;
    if (inquiry.address) { drawKeyValueRow(doc, "Address", inquiry.address, leftX, y); y += 18; }
    if (inquiry.previousSchool) { drawKeyValueRow(doc, "Previous School", inquiry.previousSchool, leftX, y); y += 18; }
    drawKeyValueRow(doc, "Inquiry Status", inquiry.status, leftX, y); y += 18;
    drawKeyValueRow(doc, "Submitted On", formatDate(inquiry.createdAt), leftX, y); y += 18;
    doc.y = y;

    // QR code summarizing the inquiry, fixed to the bottom-right of the
    // page (independent of the content flow above it).
    const qrSize = 60;
    await drawQrCode(
      doc,
      `Admission Inquiry: ${inquiry.id}\n${inquiry.branch.name}\nApplicant: ${inquiry.studentName}\nClass Applied For: ${inquiry.classAppliedFor}\nStatus: ${inquiry.status}`,
      doc.page.width - doc.page.margins.right - qrSize,
      doc.page.height - doc.page.margins.bottom - qrSize - 26,
      qrSize,
      "Scan for inquiry summary"
    );

    drawFooter(doc, `${inquiry.branch.name} - This is a computer-generated summary of an admission inquiry, not proof of admission.`);

    doc.end();
  } catch (error) {
    sendError(res, "Failed to generate admission form PDF", 500, (error as Error).message);
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
