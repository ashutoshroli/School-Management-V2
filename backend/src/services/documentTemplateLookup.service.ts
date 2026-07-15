import { DocTemplateType } from "@prisma/client";
import prisma from "../config/database";

/**
 * Looks up the admin-managed DocumentTemplate row for a given type
 * (FEE_RECEIPT, PAYSLIP, REPORT_CARD, ADMISSION_FORM, ADMIT_CARD,
 * CUSTOM), optionally scoped to one specific exam.
 *
 * DocumentTemplate is intentionally NOT branch-scoped (see the model's
 * comment in schema.prisma) - templates are an org-wide/school-wide
 * configuration managed on the Templates page, not per-branch data,
 * so every branch's fee receipts/payslips/report cards share whatever
 * template the school has uploaded for that document type.
 *
 * `examId` lets exam-related types (REPORT_CARD, ADMIT_CARD) have a
 * DIFFERENT template per exam - e.g. a school wanting a distinct
 * layout for its "Annual Exam" admit card vs. every other exam's.
 * Lookup order when `examId` is given:
 *   1. the exam-specific row (`type` + that `examId`), if uploaded.
 *   2. the type's global/default row (`type` + `examId: null`), as a
 *      fallback, so exams that never got their own template still
 *      render from whatever the school uploaded as the org-wide default.
 * When `examId` is omitted (all other types, or a caller that doesn't
 * care about per-exam templates), only the global row is looked up -
 * unchanged from the original behavior.
 *
 * There is at most one row per (type, examId) pair in practice
 * (template.controller.ts's upload endpoint updates the existing row
 * instead of creating a second one for the same slot, and the schema
 * now also enforces this via a DB-level @@unique([type, examId])).
 */
export const getActiveDocumentTemplate = async (
  type: DocTemplateType,
  examId?: string | null
): Promise<{ templateUrl: string } | null> => {
  // Point 5 (Multiple Template Upload): any number of DocumentTemplate
  // rows can now exist for the same (type, examId) slot - `isDefault`
  // picks out the ONE the admin has selected as active for generation.
  // Falls back to the most recently updated row for that slot if none
  // is (somehow) marked default, so generation never silently fails
  // just because a default flag got out of sync.
  if (examId) {
    const examTemplate =
      (await prisma.documentTemplate.findFirst({ where: { type, examId, isDefault: true }, select: { templateUrl: true } })) ||
      (await prisma.documentTemplate.findFirst({ where: { type, examId }, orderBy: { updatedAt: "desc" }, select: { templateUrl: true } }));
    if (examTemplate) return examTemplate;
  }

  const globalTemplate =
    (await prisma.documentTemplate.findFirst({ where: { type, examId: null, isDefault: true }, select: { templateUrl: true } })) ||
    (await prisma.documentTemplate.findFirst({ where: { type, examId: null }, orderBy: { updatedAt: "desc" }, select: { templateUrl: true } }));
  return globalTemplate;
};
