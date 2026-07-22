import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { canAccessBranch, resolveBranchId } from "../utils/branchScope";
import { recalculateFeeAssignmentDiscount } from "../services/feePayment.service";

/**
 * Assign discount to student, linked to ONE specific fee assignment
 * (feeAssignmentId) so it actually reduces what that fee's pending
 * amount shows - see recalculateFeeAssignmentDiscount's doc comment
 * for why a discount is scoped to one fee rather than applying
 * across every fee a student owes.
 */
export const assignDiscount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { studentId, feeAssignmentId, type, name, value, isPercent } = req.body;

    if (!feeAssignmentId) { sendError(res, "feeAssignmentId is required", 400); return; }

    const student = await prisma.student.findUnique({ where: { id: studentId }, select: { branchId: true } });
    if (!student) { sendError(res, "Student not found", 404); return; }
    if (!canAccessBranch(req, student.branchId)) { sendError(res, "Student not found", 404); return; }

    // SECURITY: the fee assignment must actually belong to THIS
    // student - otherwise a caller could grant a discount against an
    // arbitrary/other student's fee via a guessed feeAssignmentId (IDOR).
    const assignment = await prisma.feeAssignment.findUnique({
      where: { id: feeAssignmentId },
      select: { studentId: true },
    });
    if (!assignment || assignment.studentId !== studentId) {
      sendError(res, "Fee assignment not found for this student", 404);
      return;
    }

    // Sibling discount requires manual Principal approval (spec
    // Section 19) - starts PENDING and only reduces the fee once
    // approved (see recalculateFeeAssignmentDiscount's filter). Every
    // other discount type is auto-APPROVED, unchanged from before.
    const approvalStatus = type === "SIBLING" ? "PENDING" : "APPROVED";

    const discount = await prisma.studentDiscount.create({
      data: { studentId, feeAssignmentId, type, name, value, isPercent: isPercent || false, isActive: true, approvalStatus },
    });

    await recalculateFeeAssignmentDiscount(prisma, feeAssignmentId);

    sendSuccess(res, discount, approvalStatus === "PENDING" ? "Sibling discount requested - pending Principal approval" : "Discount assigned", 201);
  } catch (error) {
    sendError(res, "Failed to assign discount", 500, (error as Error).message);
  }
};

/**
 * Principal approves/rejects a PENDING sibling discount request (spec
 * Section 19). Restricted at the route level to PRINCIPAL/ADMIN roles.
 */
export const respondToDiscountApproval = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { decision } = req.body; // "APPROVE" | "REJECT"

    const discount = await prisma.studentDiscount.findUnique({ where: { id }, include: { student: { select: { branchId: true } } } });
    if (!discount) { sendError(res, "Discount not found", 404); return; }
    if (!canAccessBranch(req, discount.student.branchId)) { sendError(res, "Discount not found", 404); return; }
    if (discount.approvalStatus !== "PENDING") { sendError(res, "This discount has already been decided", 400); return; }

    const updated = await prisma.studentDiscount.update({
      where: { id },
      data: {
        approvalStatus: decision === "APPROVE" ? "APPROVED" : "REJECTED",
        approvedBy: req.user!.userId,
        approvedAt: new Date(),
      },
    });

    if (updated.feeAssignmentId) {
      await recalculateFeeAssignmentDiscount(prisma, updated.feeAssignmentId);
    }

    sendSuccess(res, updated, `Sibling discount ${decision === "APPROVE" ? "approved" : "rejected"}`);
  } catch (error) {
    sendError(res, "Failed to respond to discount approval", 500, (error as Error).message);
  }
};

/**
 * Bulk-assign the same discount "template" (type/name/value/isPercent)
 * to every ACTIVE student matching the given filters (classId and/or
 * sectionId - e.g. "give this scholarship to all Class 10 students")
 * - the discount counterpart to bulkAssignSalaryStructure/bulkPromote
 * elsewhere in this codebase. At least one of classId/sectionId is
 * required so this can never accidentally target "every student in
 * the branch" from a single call.
 *
 * feeStructureId is required (BUG FIX - see assignDiscount's doc
 * comment for why a discount must be linked to one specific
 * FeeAssignment to actually take effect): each matched student's OWN
 * FeeAssignment for this fee structure is looked up and linked
 * individually, so e.g. "10% off the Tuition Fee structure for all
 * Class 10 students" links each student's own Tuition Fee assignment,
 * not some other fee they may also owe. A matched student who has no
 * FeeAssignment yet for this structure (fee not assigned to them yet)
 * is skipped and counted separately, since there is nothing valid to
 * link the discount to.
 *
 * Unlike bulkAssignSalaryStructure (one structure per staff, so
 * "already has one" is a meaningful skip condition),
 * StudentDiscount has no unique constraint preventing a student from
 * holding several discounts of the same type/name - so this always
 * creates a new discount row per matched student rather than
 * skipping/overwriting, via a single createMany.
 */
export const bulkAssignDiscount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { classId, sectionId, feeStructureId, type, name, value, isPercent } = req.body;

    if (!classId && !sectionId) {
      sendError(res, "At least one of classId or sectionId is required to target students", 400);
      return;
    }
    if (!feeStructureId) {
      sendError(res, "feeStructureId is required so this discount can be linked to each student's fee", 400);
      return;
    }

    const branchId = resolveBranchId(req);
    if (!branchId) { sendError(res, "Branch ID required", 400); return; }

    const structure = await prisma.feeStructure.findUnique({ where: { id: feeStructureId }, select: { branchId: true } });
    if (!structure || structure.branchId !== branchId) {
      sendError(res, "Fee structure not found", 404);
      return;
    }

    const studentWhere: any = { branchId, isActive: true };
    if (classId) studentWhere.classId = classId;
    if (sectionId) studentWhere.sectionId = sectionId;

    const students = await prisma.student.findMany({ where: studentWhere, select: { id: true } });
    if (students.length === 0) {
      sendSuccess(res, { assigned: 0, skipped: 0, total: 0 }, "No active students matched the given filters");
      return;
    }

    // Each matched student's OWN assignment for this fee structure -
    // students with no assignment for it yet are skipped (nothing
    // valid to link the discount to).
    const assignments = await prisma.feeAssignment.findMany({
      where: { feeStructureId, studentId: { in: students.map((s) => s.id) } },
      select: { id: true, studentId: true },
    });
    const assignmentByStudent = new Map(assignments.map((a) => [a.studentId, a.id]));

    const toCreate = students
      .filter((s) => assignmentByStudent.has(s.id))
      .map((s) => ({
        studentId: s.id,
        feeAssignmentId: assignmentByStudent.get(s.id)!,
        type, name, value, isPercent: isPercent || false, isActive: true,
      }));

    if (toCreate.length > 0) {
      await prisma.studentDiscount.createMany({ data: toCreate });
      // Recalculate each affected FeeAssignment - one discount row was
      // just created per assignment here, so this is a straight
      // one-recalculation-per-newly-linked-assignment loop (no batching
      // concern - bulk discount grants are an occasional admin action,
      // not a hot path).
      await Promise.all(toCreate.map((d) => recalculateFeeAssignmentDiscount(prisma, d.feeAssignmentId)));
    }

    const skipped = students.length - toCreate.length;
    sendSuccess(
      res,
      { assigned: toCreate.length, skipped, total: students.length },
      `Discount assigned to ${toCreate.length} student(s)` + (skipped > 0 ? ` (${skipped} skipped - no fee assignment for this structure yet)` : ""),
      201
    );
  } catch (error) {
    sendError(res, "Failed to bulk-assign discount", 500, (error as Error).message);
  }
};

/**
 * Branch-wide discount list, for an accountant auditing every active
 * (or, with `includeInactive=true`, every) concession currently
 * granted - unlike getStudentDiscounts below (one student's own
 * history, shown on their profile page), this is the "who has a
 * discount at all" overview a finance office needs periodically.
 * Optionally narrowed to a single `type` (SIBLING/RTE/etc).
 */
export const getAllDiscounts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    if (!branchId) { sendError(res, "Branch ID required", 400); return; }

    const includeInactive = req.query.includeInactive === "true";
    const type = req.query.type as string | undefined;
    const classId = req.query.classId as string | undefined;
    const sectionId = req.query.sectionId as string | undefined;

    const studentFilter: any = { branchId };
    if (classId) studentFilter.classId = classId;
    if (sectionId) studentFilter.sectionId = sectionId;

    const where: any = { student: studentFilter };
    if (!includeInactive) where.isActive = true;
    if (type) where.type = type;

    const discounts = await prisma.studentDiscount.findMany({
      where,
      include: {
        student: {
          select: {
            id: true,
            admissionNo: true,
            user: { select: { name: true } },
            class: { select: { name: true } },
            section: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    sendSuccess(res, discounts, "Discounts fetched");
  } catch (error) {
    sendError(res, "Failed to fetch discounts", 500, (error as Error).message);
  }
};

/**
 * Get single discount detail - both getAllDiscounts (branch-wide) and
 * getStudentDiscounts (per-student) return lists, but there was no way
 * to fetch one specific discount row directly (e.g. for a detail
 * modal launched from either list).
 */
export const getDiscountById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const discount = await prisma.studentDiscount.findUnique({
      where: { id },
      include: {
        student: {
          select: {
            id: true,
            admissionNo: true,
            branchId: true,
            user: { select: { name: true } },
            class: { select: { name: true } },
            section: { select: { name: true } },
          },
        },
      },
    });
    if (!discount) { sendError(res, "Discount not found", 404); return; }
    if (!canAccessBranch(req, discount.student.branchId)) { sendError(res, "Discount not found", 404); return; }

    sendSuccess(res, discount, "Discount fetched");
  } catch (error) {
    sendError(res, "Failed to fetch discount", 500, (error as Error).message);
  }
};

/**
 * Get student's discounts
 */
export const getStudentDiscounts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { studentId } = req.params;

    const discounts = await prisma.studentDiscount.findMany({
      where: { studentId },
      orderBy: { createdAt: "desc" },
    });

    sendSuccess(res, discounts, "Discounts fetched");
  } catch (error) {
    sendError(res, "Failed to fetch discounts", 500, (error as Error).message);
  }
};

/**
 * Toggle discount active/inactive.
 * BUG FIX: recalculates the linked FeeAssignment.discount afterward -
 * deactivating a discount must immediately restore the amount it was
 * waiving (and reactivating must re-apply it), not just flip a flag
 * that nothing downstream ever reads.
 */
export const toggleDiscount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const discount = await prisma.studentDiscount.findUnique({ where: { id }, include: { student: { select: { branchId: true } } } });
    if (!discount) { sendError(res, "Discount not found", 404); return; }
    if (!canAccessBranch(req, discount.student.branchId)) { sendError(res, "Discount not found", 404); return; }

    const updated = await prisma.studentDiscount.update({
      where: { id },
      data: { isActive: !discount.isActive },
    });

    if (updated.feeAssignmentId) {
      await recalculateFeeAssignmentDiscount(prisma, updated.feeAssignmentId);
    }

    sendSuccess(res, updated, `Discount ${updated.isActive ? "activated" : "deactivated"}`);
  } catch (error) {
    sendError(res, "Failed to toggle discount", 500, (error as Error).message);
  }
};

/**
 * Delete discount.
 * BUG FIX: recalculates the linked FeeAssignment.discount afterward -
 * removing a discount must immediately restore the amount it was
 * waiving, for the same reason as toggleDiscount above.
 */
export const deleteDiscount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const discount = await prisma.studentDiscount.findUnique({ where: { id }, include: { student: { select: { branchId: true } } } });
    if (!discount) { sendError(res, "Discount not found", 404); return; }
    if (!canAccessBranch(req, discount.student.branchId)) { sendError(res, "Discount not found", 404); return; }

    await prisma.studentDiscount.delete({ where: { id } });

    if (discount.feeAssignmentId) {
      await recalculateFeeAssignmentDiscount(prisma, discount.feeAssignmentId);
    }

    sendSuccess(res, null, "Discount removed");
  } catch (error) {
    sendError(res, "Failed to delete discount", 500, (error as Error).message);
  }
};
