import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { canAccessBranch } from "../utils/branchScope";

/**
 * Bulk promote students (year-end).
 *
 * Every ACTIVE student currently in `fromClassId` (optionally narrowed
 * to a single `fromSectionId`) falls into exactly one of three buckets:
 *   - `detainedStudentIds` -> DETAINED: stays in the same class/section,
 *     just recorded as not promoted this year.
 *   - `tcIssuedStudentIds` -> TC_ISSUED: leaving the school - marked
 *     inactive (mirrors deleteStudent's "deactivate, don't delete"
 *     guidance for anyone with real academic history) with
 *     leavingDate/leavingReason set, same as the manual "mark as left"
 *     fields already on the Student model.
 *   - everyone else -> PROMOTED: moved to `toClassId`/`toSectionId`.
 *
 * SECURITY FIX: this endpoint used to have NO branch-access check at
 * all - it queried `student.findMany({ where: { classId: fromClassId } })`
 * with no branchId filter, and wrote `toClassId`/`toSectionId` straight
 * from the request body with no ownership check either. A Branch Admin
 * (whose JWT branchId is scoped to their own branch) could pass ANY
 * other branch's real classId/sectionId values (guessable/enumerable
 * cuid()s, or simply values seen elsewhere in the app) as
 * fromClassId/toClassId/toSectionId and bulk-promote or bulk-detain
 * students belonging to a branch they have no access to (IDOR) - this
 * mirrors the exact class of bug already fixed in
 * class.controller.ts's createClass/createSection/createSubject (see
 * those functions' "BUG FIX + SECURITY" comments) and
 * assignSubjectTeacher's cross-branch check, just never applied here.
 * Fixed by resolving fromClassId's/toClassId's/toSectionId's OWN
 * branchId from the DB and requiring canAccessBranch for every one of
 * them (SUPER_ADMIN unaffected, per canAccessBranch's existing rules).
 *
 * DATA INTEGRITY FIX: the previous implementation defaulted a missing
 * `toSectionId` to the student's EXISTING `sectionId` -
 * (`sectionId: toSectionId || student.sectionId`). Section.classId is
 * fixed per section (a section belongs to exactly one class), so
 * keeping the OLD section while changing `classId` to a DIFFERENT
 * class produced a Student row whose `sectionId` referenced a Section
 * that belongs to a different class than the student's own `classId`
 * - silently inconsistent data (e.g. a promoted-to-Class-6 student
 * still pointing at a "Class 5 - A" section row). `toSectionId` is now
 * a required field with no fallback - see promotion.validator.ts.
 *
 * PERFORMANCE: rewritten from a sequential per-student loop (one
 * `Promotion.create` + one conditional `Student.update` per student,
 * awaited one at a time) to bulk `createMany`/`updateMany` calls - safe
 * here because every student within a given bucket (promoted/detained/
 * tc-issued) receives IDENTICAL field values, so there's nothing that
 * varies row-to-row for a bulk write to lose. Matches the bulk-write
 * pattern already used by bulkAssignSalaryStructure/bulkAssignFees
 * elsewhere in this codebase.
 */
export const bulkPromote = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      academicYearId,
      fromClassId,
      fromSectionId,
      toClassId,
      toSectionId,
      detainedStudentIds,
      tcIssuedStudentIds,
    } = req.body;

    const [fromClass, toClass, toSection] = await Promise.all([
      prisma.class.findUnique({ where: { id: fromClassId } }),
      prisma.class.findUnique({ where: { id: toClassId } }),
      prisma.section.findUnique({ where: { id: toSectionId } }),
    ]);

    if (!fromClass) { sendError(res, "Source class not found", 404); return; }
    if (!toClass) { sendError(res, "Target class not found", 404); return; }
    if (!toSection) { sendError(res, "Target section not found", 404); return; }
    if (toSection.classId !== toClassId) {
      sendError(res, "Target section does not belong to the target class", 400);
      return;
    }

    // SECURITY: every class/section referenced must belong to a branch
    // the caller can access - see this function's doc comment above.
    const branchIds = new Set([fromClass.branchId, toClass.branchId, toSection.branchId]);
    if (branchIds.size > 1 || !canAccessBranch(req, fromClass.branchId)) {
      sendError(res, "Source class, target class, and target section must all belong to a branch you can access", 403);
      return;
    }

    const where: any = { classId: fromClassId, isActive: true };
    if (fromSectionId) where.sectionId = fromSectionId;

    const students = await prisma.student.findMany({ where, select: { id: true } });
    if (students.length === 0) {
      sendSuccess(res, { promoted: 0, detained: 0, tcIssued: 0, total: 0 }, "No active students found in the source class/section");
      return;
    }

    const detainedSet = new Set<string>(detainedStudentIds || []);
    const tcIssuedSet = new Set<string>(tcIssuedStudentIds || []);
    const allIds = students.map((s) => s.id);
    // Every in-scope student ends up in EXACTLY ONE bucket - a stray id
    // in either list that doesn't belong to this source class/section
    // is silently ignored (since both lists come from a UI checkbox
    // selection scoped to the same student list), and a student
    // mistakenly present in BOTH lists is treated as tc-issued (leaving
    // outranks staying-but-detained) rather than being processed twice
    // (which would otherwise create two conflicting Promotion history
    // rows and run two conflicting Student.updateMany writes for them).
    const tcIssuedIds = allIds.filter((id) => tcIssuedSet.has(id));
    const detainedIds = allIds.filter((id) => detainedSet.has(id) && !tcIssuedSet.has(id));
    const promotedIds = allIds.filter((id) => !detainedSet.has(id) && !tcIssuedSet.has(id));

    const now = new Date();

    await prisma.$transaction([
      // One Promotion history row per student, batched per bucket.
      ...(promotedIds.length > 0
        ? [
            prisma.promotion.createMany({
              data: promotedIds.map((studentId) => ({
                studentId, academicYearId, fromClassId, toClassId, status: "PROMOTED" as const,
              })),
            }),
          ]
        : []),
      ...(detainedIds.length > 0
        ? [
            prisma.promotion.createMany({
              data: detainedIds.map((studentId) => ({
                studentId, academicYearId, fromClassId, toClassId: null, status: "DETAINED" as const,
              })),
            }),
          ]
        : []),
      ...(tcIssuedIds.length > 0
        ? [
            prisma.promotion.createMany({
              data: tcIssuedIds.map((studentId) => ({
                studentId, academicYearId, fromClassId, toClassId: null, status: "TC_ISSUED" as const,
              })),
            }),
          ]
        : []),
      // Move every promoted student to the target class/section in one
      // statement (identical destination for all of them).
      ...(promotedIds.length > 0
        ? [
            prisma.student.updateMany({
              where: { id: { in: promotedIds } },
              data: { classId: toClassId, sectionId: toSectionId },
            }),
          ]
        : []),
      // TC-issued students are leaving the school - deactivate (never
      // hard-delete; they may have payment/academic history - see
      // deleteStudent's own "deactivate instead" guard for payments)
      // and record it via the same leavingDate/leavingReason fields the
      // manual student-edit form already uses.
      ...(tcIssuedIds.length > 0
        ? [
            prisma.student.updateMany({
              where: { id: { in: tcIssuedIds } },
              data: { isActive: false, leavingDate: now, leavingReason: "TC issued (year-end promotion)" },
            }),
          ]
        : []),
    ]);

    sendSuccess(
      res,
      { promoted: promotedIds.length, detained: detainedIds.length, tcIssued: tcIssuedIds.length, total: allIds.length },
      `Promotion done: ${promotedIds.length} promoted, ${detainedIds.length} detained, ${tcIssuedIds.length} issued TC`
    );
  } catch (error) {
    sendError(res, "Failed to process promotion", 500, (error as Error).message);
  }
};
