import { Response } from "express";
import { CertificateType, DocTemplateType } from "@prisma/client";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { storage } from "../services/storage.service";
import { logAuditFromRequest } from "../services/auditLog.service";

/**
 * This controller is the missing "upload" half of two Prisma models
 * that already existed in the schema but had no real UI/API wired up:
 *
 *  - CertificateTemplate.templateUrl - previously only settable via a
 *    raw text field on POST /communication/certificates/templates
 *    (createTemplate in certificate.controller.ts), which nobody used
 *    in practice since there's no way to type in a working file URL
 *    by hand.
 *  - DocumentTemplate - had a model (Fee Receipt / Payslip / Report
 *    Card / Admission Form / Custom templates) but literally no
 *    controller or route at all anywhere in the codebase.
 *
 * Both share the exact same shape (name + type + a single DOCX file),
 * so a single "Templates" page/endpoint set manages both, distinguished
 * by a `?category=certificate|document` query/body field.
 */

const CERTIFICATE_TYPES = Object.values(CertificateType);
const DOCUMENT_TYPES = Object.values(DocTemplateType);

const DOCX_EXTENSION = /\.docx$/i;

type Category = "certificate" | "document";

const isValidCategory = (value: unknown): value is Category => value === "certificate" || value === "document";

/**
 * GET /api/templates?category=certificate|document
 * Lists all templates in one category (both models are branch-agnostic
 * - templates are an org-wide/school-wide configuration, not per-branch
 * data - so no branch scoping is needed here, matching how
 * CertificateTemplate.getTemplates already behaved).
 */
export const getTemplatesByCategory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const category = req.query.category as string;
    if (!isValidCategory(category)) {
      sendError(res, "category must be 'certificate' or 'document'", 400);
      return;
    }

    if (category === "certificate") {
      const templates = await prisma.certificateTemplate.findMany({ orderBy: { name: "asc" } });
      sendSuccess(res, templates, "Templates fetched");
    } else {
      const templates = await prisma.documentTemplate.findMany({ orderBy: { name: "asc" } });
      sendSuccess(res, templates, "Templates fetched");
    }
  } catch (error) {
    sendError(res, "Failed to fetch templates", 500, (error as Error).message);
  }
};

/**
 * POST /api/templates/upload
 * Multipart body: file (the .docx), category ("certificate" | "document"),
 * type (one of CertificateType / DocTemplateType depending on category),
 * name (display name shown on the Templates page).
 *
 * If an active template of the same category+type already exists, its
 * old file is replaced (and the old file deleted from storage) rather
 * than creating a duplicate row - each template "slot" (e.g. Bonafide,
 * Fee Receipt) has exactly one current DOCX at a time, matching how the
 * Templates page presents one card per type with an "Upload"/"Replace"
 * button.
 */
export const uploadTemplateFile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      sendError(res, "No file uploaded (expected multipart field 'file')", 400);
      return;
    }
    if (!DOCX_EXTENSION.test(req.file.originalname)) {
      sendError(res, "Only .docx files are allowed for templates", 400);
      return;
    }

    const { category, type, name } = req.body as { category?: string; type?: string; name?: string };
    if (!isValidCategory(category)) {
      sendError(res, "category must be 'certificate' or 'document'", 400);
      return;
    }
    if (!name || !name.trim()) {
      sendError(res, "name is required", 400);
      return;
    }

    const { url } = await storage.save(req.file.buffer, req.file.originalname, `templates/${category}`);

    if (category === "certificate") {
      if (!CERTIFICATE_TYPES.includes(type as CertificateType)) {
        sendError(res, `type must be one of: ${CERTIFICATE_TYPES.join(", ")}`, 400);
        return;
      }

      const existing = await prisma.certificateTemplate.findFirst({ where: { type: type as CertificateType } });
      let template;
      if (existing) {
        template = await prisma.certificateTemplate.update({
          where: { id: existing.id },
          data: { name: name.trim(), templateUrl: url, isActive: true },
        });
        await storage.deleteByUrl(existing.templateUrl).catch(() => undefined);
        logAuditFromRequest(req, "UPDATE", "certificateTemplate", template.id, { oldData: existing, newData: template });
      } else {
        template = await prisma.certificateTemplate.create({
          data: { name: name.trim(), type: type as CertificateType, templateUrl: url, isActive: true },
        });
        logAuditFromRequest(req, "CREATE", "certificateTemplate", template.id, { newData: template });
      }

      sendSuccess(res, template, "Template uploaded", existing ? 200 : 201);
      return;
    }

    // category === "document"
    if (!DOCUMENT_TYPES.includes(type as DocTemplateType)) {
      sendError(res, `type must be one of: ${DOCUMENT_TYPES.join(", ")}`, 400);
      return;
    }

    const existing = await prisma.documentTemplate.findFirst({ where: { type: type as DocTemplateType } });
    let template;
    if (existing) {
      template = await prisma.documentTemplate.update({
        where: { id: existing.id },
        data: { name: name.trim(), templateUrl: url },
      });
      await storage.deleteByUrl(existing.templateUrl).catch(() => undefined);
      logAuditFromRequest(req, "UPDATE", "documentTemplate", template.id, { oldData: existing, newData: template });
    } else {
      template = await prisma.documentTemplate.create({
        data: { name: name.trim(), type: type as DocTemplateType, templateUrl: url },
      });
      logAuditFromRequest(req, "CREATE", "documentTemplate", template.id, { newData: template });
    }

    sendSuccess(res, template, "Template uploaded", existing ? 200 : 201);
  } catch (error) {
    sendError(res, "Failed to upload template", 500, (error as Error).message);
  }
};

/**
 * DELETE /api/templates/:id?category=certificate|document
 * Removes a template's DB row and its stored DOCX file.
 */
export const deleteTemplateFile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const category = req.query.category as string;
    if (!isValidCategory(category)) {
      sendError(res, "category must be 'certificate' or 'document'", 400);
      return;
    }

    if (category === "certificate") {
      const template = await prisma.certificateTemplate.findUnique({ where: { id } });
      if (!template) { sendError(res, "Template not found", 404); return; }

      // A CertificateTemplate that already has generated certificates
      // linked to it can't be hard-deleted without breaking that
      // history (GeneratedCertificate.templateId is a required FK) -
      // deactivate instead, same as the rest of the app already does
      // for "soft delete" style records (e.g. isActive toggles).
      const generatedCount = await prisma.generatedCertificate.count({ where: { templateId: id } });
      if (generatedCount > 0) {
        const updated = await prisma.certificateTemplate.update({ where: { id }, data: { isActive: false } });
        logAuditFromRequest(req, "UPDATE", "certificateTemplate", id, { oldData: template, newData: updated });
        sendSuccess(res, updated, "Template has generated certificates and was deactivated instead of deleted");
        return;
      }

      await prisma.certificateTemplate.delete({ where: { id } });
      await storage.deleteByUrl(template.templateUrl).catch(() => undefined);
      logAuditFromRequest(req, "DELETE", "certificateTemplate", id, { oldData: template });
      sendSuccess(res, null, "Template deleted");
      return;
    }

    const template = await prisma.documentTemplate.findUnique({ where: { id } });
    if (!template) { sendError(res, "Template not found", 404); return; }

    await prisma.documentTemplate.delete({ where: { id } });
    await storage.deleteByUrl(template.templateUrl).catch(() => undefined);
    logAuditFromRequest(req, "DELETE", "documentTemplate", id, { oldData: template });
    sendSuccess(res, null, "Template deleted");
  } catch (error) {
    sendError(res, "Failed to delete template", 500, (error as Error).message);
  }
};
