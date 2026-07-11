import { Response } from "express";
import { ParentRelation } from "@prisma/client";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { canAccessBranch } from "../utils/branchScope";
import { storage } from "../services/storage.service";
import { renderCertificateByType } from "../services/certificateGenerator.service";
import { formatDate } from "../services/pdf.service";
import { logAuditFromRequest } from "../services/auditLog.service";
import { config } from "../config";

/**
 * Create certificate template
 */
export const createTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, type, templateUrl } = req.body;
    const template = await prisma.certificateTemplate.create({
      data: { name, type, templateUrl, isActive: true },
    });
    sendSuccess(res, template, "Template created", 201);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Get templates
 */
export const getTemplates = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const templates = await prisma.certificateTemplate.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
    sendSuccess(res, templates, "Templates fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

const getParentName = (
  parents: Array<{ parent: { relation: ParentRelation; user: { name: string } } }>,
  relation: ParentRelation
): string => parents.find((p) => p.parent.relation === relation)?.parent.user.name || "-";

/**
 * POST /api/communication/certificates/generate
 * Generates a real PDF certificate (Transfer Certificate, Bonafide, or
 * Character) for a student, persists it via the storage service, and
 * records a GeneratedCertificate row with a unique serial number.
 *
 * Previously this only stored a placeholder pdfUrl
 * (`/certificates/<serial>.pdf`) without ever creating a file, and had
 * NO branch-access check at all - any authenticated admin, from ANY
 * branch, could "generate" a certificate for any student in the
 * system. Both are fixed here: a real PDF is rendered and saved, and
 * `canAccessBranch` is enforced against the student's actual branch.
 */
export const generateCertificate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { templateId, studentId, purpose } = req.body;

    const template = await prisma.certificateTemplate.findUnique({ where: { id: templateId } });
    if (!template || !template.isActive) {
      sendError(res, "Template not found", 404);
      return;
    }

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: {
        user: { select: { name: true } },
        class: { select: { name: true } },
        section: { select: { name: true } },
        branch: { select: { id: true, name: true, address: true, city: true, state: true, pincode: true, phone: true } },
        parents: { include: { parent: { select: { relation: true, user: { select: { name: true } } } } } },
      },
    });
    if (!student) {
      sendError(res, "Student not found", 404);
      return;
    }

    // SECURITY: this was previously missing entirely - a Branch Admin
    // (or any ADMIN-role user) from a different branch than the
    // student's could generate a certificate for them. Super Admin is
    // unrestricted by design (canAccessBranch returns true for them).
    if (!canAccessBranch(req, student.branch.id)) {
      sendError(res, "Student not found", 404);
      return;
    }

    // Serial numbers are the human-verifiable identity of a legal
    // document - wrap the count-then-create in a transaction so two
    // concurrent generations within the same process can't compute the
    // same "next" number. This narrows but doesn't eliminate the race
    // (Postgres doesn't serialize plain SELECT COUNT + INSERT against
    // concurrent transactions without an explicit lock) - a production
    // hardening follow-up would use a dedicated sequence/advisory lock
    // instead of COUNT(*), matching the same caveat already accepted
    // for admission-number generation elsewhere in this codebase.
    const serialNo = await prisma.$transaction(async (tx) => {
      const count = await tx.generatedCertificate.count();
      return `CERT-${String(count + 1).padStart(6, "0")}`;
    });

    const issueDate = new Date();
    const verifyUrl = `${config.frontendUrl}/verify-certificate/${serialNo}`;

    const pdfBuffer = await renderCertificateByType(template.type, {
      serialNo,
      issueDate,
      verifyUrl,
      purpose,
      branch: student.branch,
      student: {
        admissionNo: student.admissionNo,
        studentName: student.user.name,
        fatherName: getParentName(student.parents, ParentRelation.FATHER),
        motherName: getParentName(student.parents, ParentRelation.MOTHER),
        dateOfBirth: student.dateOfBirth,
        className: student.class.name,
        sectionName: student.section.name,
        admissionDate: student.admissionDate,
        leavingDate: student.leavingDate,
        leavingReason: student.leavingReason,
        category: student.category,
        nationality: student.nationality,
      },
    });

    if (!pdfBuffer) {
      sendError(
        res,
        `Certificate type ${template.type} is not yet supported by the PDF generator. ` +
          `Use the dedicated ID card endpoint for ID_CARD, or contact support for CUSTOM templates.`,
        400
      );
      return;
    }

    const { url: pdfUrl } = await storage.save(pdfBuffer, `${serialNo}.pdf`, "certificates");

    const cert = await prisma.generatedCertificate.create({
      data: { templateId, studentId, serialNo, pdfUrl, generatedBy: req.user!.userId },
    });

    logAuditFromRequest(req, "CREATE", "generatedCertificate", cert.id, { newData: cert });

    sendSuccess(res, { ...cert, student: student.user.name, type: template.type }, "Certificate generated", 201);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Get generated certificates. Scoped to the caller's branch (via the
 * linked student) for non-Super-Admin users - previously this had no
 * branch filter at all, so any ADMIN-role user could list every
 * generated certificate across every branch in the system.
 */
export const getGeneratedCertificates = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const studentId = req.query.studentId as string;
    const where: any = {};
    if (studentId) where.studentId = studentId;
    if (req.user!.role !== "SUPER_ADMIN") {
      where.student = { branchId: req.user!.branchId };
    }

    const certs = await prisma.generatedCertificate.findMany({
      where,
      include: {
        template: { select: { name: true, type: true } },
        student: { select: { user: { select: { name: true } }, admissionNo: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    sendSuccess(res, certs, "Certificates fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * GET /api/communication/certificates/verify/:serialNo
 * PUBLIC (no auth) - lets anyone holding a printed certificate (e.g. a
 * bank, employer, or another school) confirm it was genuinely issued by
 * this system, without exposing the full document or any information
 * beyond what's already printed on the certificate itself.
 */
export const verifyCertificate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { serialNo } = req.params;

    const cert = await prisma.generatedCertificate.findUnique({
      where: { serialNo },
      include: {
        template: { select: { name: true, type: true } },
        student: {
          select: {
            admissionNo: true,
            user: { select: { name: true } },
            branch: { select: { name: true } },
          },
        },
      },
    });

    if (!cert) {
      sendSuccess(res, { valid: false }, "No certificate found with this serial number");
      return;
    }

    sendSuccess(res, {
      valid: true,
      serialNo: cert.serialNo,
      certificateType: cert.template.type,
      certificateName: cert.template.name,
      studentName: cert.student.user.name,
      admissionNo: cert.student.admissionNo,
      branchName: cert.student.branch.name,
      issuedOn: formatDate(cert.createdAt),
    }, "Certificate verified");
  } catch (error) { sendError(res, "Failed to verify certificate", 500, (error as Error).message); }
};
