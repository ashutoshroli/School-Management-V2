import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";

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

/**
 * Generate certificate for a student (placeholder - actual DOCX->PDF in production)
 */
export const generateCertificate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { templateId, studentId } = req.body;

    const template = await prisma.certificateTemplate.findUnique({ where: { id: templateId } });
    if (!template) { sendError(res, "Template not found", 404); return; }

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: { user: { select: { name: true } }, class: { select: { name: true } }, branch: { select: { name: true } } },
    });
    if (!student) { sendError(res, "Student not found", 404); return; }

    // Generate serial number
    const count = await prisma.generatedCertificate.count();
    const serialNo = `CERT-${String(count + 1).padStart(6, "0")}`;

    // In production: use docxtemplater to fill template + LibreOffice to convert to PDF
    // For now: store as placeholder PDF URL
    const pdfUrl = `/certificates/${serialNo}.pdf`;

    const cert = await prisma.generatedCertificate.create({
      data: { templateId, studentId, serialNo, pdfUrl, generatedBy: req.user!.userId },
    });

    sendSuccess(res, { ...cert, student: student.user.name, type: template.type }, "Certificate generated", 201);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Get generated certificates
 */
export const getGeneratedCertificates = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const studentId = req.query.studentId as string;
    const where: any = {};
    if (studentId) where.studentId = studentId;

    const certs = await prisma.generatedCertificate.findMany({
      where,
      include: { template: { select: { name: true, type: true } } },
      orderBy: { createdAt: "desc" },
    });
    sendSuccess(res, certs, "Certificates fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};
