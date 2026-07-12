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
 * Core certificate-generation logic, shared by the single-student
 * `generateCertificate` endpoint and `bulkGenerateCertificates` below,
 * so a class-wide batch run produces IDENTICAL PDFs/records to
 * generating one at a time - it always throws (rather than returning
 * an error shape) on any failure, letting each caller decide how to
 * report that (a single 4xx response vs. one entry in a bulk-run
 * failures list).
 *
 * Previously `generateCertificate` only stored a placeholder pdfUrl
 * (`/certificates/<serial>.pdf`) without ever creating a file, and had
 * NO branch-access check at all - any authenticated admin, from ANY
 * branch, could "generate" a certificate for any student in the
 * system. Both are fixed here: a real PDF is rendered and saved, and
 * `canAccessBranch` is enforced against the student's actual branch.
 */
const generateCertificateCore = async (
  req: AuthRequest,
  { templateId, studentId, purpose, customFields }: { templateId: string; studentId: string; purpose?: string; customFields?: Record<string, string> }
) => {
  const template = await prisma.certificateTemplate.findUnique({ where: { id: templateId } });
  if (!template || !template.isActive) {
    throw new Error("Template not found");
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
    throw new Error("Student not found");
  }

  // SECURITY: see this function's doc comment above. Super Admin is
  // unrestricted by design (canAccessBranch returns true for them).
  if (!canAccessBranch(req, student.branch.id)) {
    throw new Error("Student not found");
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
    // Only meaningfully used by a CUSTOM template's placeholders -
    // see CertificateRenderParams.extraFields's doc comment.
    extraFields: customFields,
    templateUrl: template.templateUrl,
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
    const hint =
      template.type === "CUSTOM"
        ? "CUSTOM certificates have no built-in layout - upload a .docx template for it on the Templates page first (any custom field values you supplied here only fill placeholders in that uploaded template)."
        : `Upload a .docx template for this type on the Templates page, or use the dedicated ID card endpoint for ID_CARD.`;
    throw new Error(`Certificate type ${template.type} is not yet supported by the PDF generator. ${hint}`);
  }

  const { url: pdfUrl } = await storage.save(pdfBuffer, `${serialNo}.pdf`, "certificates");

  const cert = await prisma.generatedCertificate.create({
    data: { templateId, studentId, serialNo, pdfUrl, generatedBy: req.user!.userId },
  });

  logAuditFromRequest(req, "CREATE", "generatedCertificate", cert.id, { newData: cert });

  return { ...cert, student: student.user.name, type: template.type };
};

/**
 * POST /api/communication/certificates/generate
 * Generates a real PDF certificate (Transfer Certificate, Bonafide, or
 * Character) for a single student - see generateCertificateCore above
 * for the actual generation logic shared with bulkGenerateCertificates.
 */
export const generateCertificate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { templateId, studentId, purpose, customFields } = req.body;
    const result = await generateCertificateCore(req, { templateId, studentId, purpose, customFields });
    sendSuccess(res, result, "Certificate generated", 201);
  } catch (error) {
    const message = (error as Error).message;
    const status = message === "Template not found" || message === "Student not found" ? 404 : 400;
    sendError(res, message, status);
  }
};

/**
 * Generate the same certificate template for every ACTIVE student in
 * a class at once (e.g. Transfer/Bonafide/Character certificates
 * class-wide) - matching the ID-card batch pattern that already
 * exists (getClassIdCardsBatchPdf in document.controller.ts), but for
 * the prose-certificate types handled by generateCertificateCore above.
 * CUSTOM/ID_CARD are rejected up front (see that function's own
 * per-type PDF-support check) since a batch run failing midway through
 * on an unsupported type would be a confusing partial result.
 *
 * Runs sequentially (not Promise.all) rather than in parallel - each
 * generation needs its own atomically-incremented serial number (see
 * generateCertificateCore's transaction comment), so overlapping calls
 * would only worsen that race, not help throughput meaningfully for
 * what's normally a "one class at a time" admin action.
 */
export const bulkGenerateCertificates = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { templateId, classId, purpose } = req.body;

    const template = await prisma.certificateTemplate.findUnique({ where: { id: templateId } });
    if (!template || !template.isActive) { sendError(res, "Template not found", 404); return; }
    if (template.type === "CUSTOM" || template.type === "ID_CARD") {
      sendError(res, `Bulk generation is not supported for ${template.type} - use the single-certificate flow instead.`, 400);
      return;
    }

    const cls = await prisma.class.findUnique({ where: { id: classId } });
    if (!cls) { sendError(res, "Class not found", 404); return; }
    if (!canAccessBranch(req, cls.branchId)) { sendError(res, "Class not found", 404); return; }

    const students = await prisma.student.findMany({ where: { classId, isActive: true }, select: { id: true } });
    if (students.length === 0) {
      sendSuccess(res, { generated: 0, failed: 0, total: 0, failures: [] }, "No active students found in this class");
      return;
    }

    let generated = 0;
    const failures: { studentId: string; error: string }[] = [];
    for (const student of students) {
      try {
        await generateCertificateCore(req, { templateId, studentId: student.id, purpose });
        generated++;
      } catch (err) {
        failures.push({ studentId: student.id, error: (err as Error).message });
      }
    }

    sendSuccess(
      res,
      { generated, failed: failures.length, total: students.length, failures },
      `Generated ${generated} certificate(s)` + (failures.length > 0 ? ` (${failures.length} failed)` : "")
    );
  } catch (error) {
    sendError(res, "Failed to bulk-generate certificates", 500, (error as Error).message);
  }
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
    const classId = req.query.classId as string | undefined;
    const type = req.query.type as string | undefined;
    const fromDate = req.query.fromDate as string | undefined;
    const toDate = req.query.toDate as string | undefined;

    const where: any = {};
    if (studentId) where.studentId = studentId;
    if (classId) where.student = { ...(where.student || {}), classId };
    if (type) where.template = { type };
    if (fromDate) where.createdAt = { ...(where.createdAt || {}), gte: new Date(fromDate) };
    if (toDate) where.createdAt = { ...(where.createdAt || {}), lte: new Date(toDate) };
    if (req.user!.role !== "SUPER_ADMIN") {
      where.student = { ...(where.student || {}), branchId: req.user!.branchId };
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
