import { DocTemplateType } from "@prisma/client";
import prisma from "../config/database";

/**
 * Looks up the single admin-managed DocumentTemplate row for a given
 * type (FEE_RECEIPT, PAYSLIP, REPORT_CARD, ADMISSION_FORM, CUSTOM).
 *
 * DocumentTemplate is intentionally NOT branch-scoped (see the model's
 * comment in schema.prisma) - templates are an org-wide/school-wide
 * configuration managed on the Templates page, not per-branch data,
 * so every branch's fee receipts/payslips/report cards share whatever
 * template the school has uploaded for that document type. There is
 * at most one row per type in practice (template.controller.ts's
 * upload endpoint updates the existing row instead of creating a
 * second one for the same type), so `findFirst` is equivalent to a
 * unique lookup without needing a DB-level unique constraint on `type`.
 */
export const getActiveDocumentTemplate = async (type: DocTemplateType): Promise<{ templateUrl: string } | null> => {
  const template = await prisma.documentTemplate.findFirst({ where: { type }, select: { templateUrl: true } });
  return template;
};
