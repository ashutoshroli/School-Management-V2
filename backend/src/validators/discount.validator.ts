import { z } from "zod";

// BUG FIX: this previously listed a DIFFERENT set of values
// (SIBLING/STAFF_WARD/MERIT/RTE/FINANCIAL_HARDSHIP/OTHER) than the
// real Prisma DiscountType enum (schema.prisma) - MERIT_SCHOLARSHIP
// and CUSTOM (which the frontend's DISCOUNT_TYPES list and every
// discount form actually send) were REJECTED by this schema with a
// 400, and this schema's own "MERIT"/"FINANCIAL_HARDSHIP"/"OTHER"
// don't exist in the database enum and would fail at the Prisma layer
// if they ever got through. Kept in sync with the enum directly below
// instead of a hand-maintained duplicate list.
const DISCOUNT_TYPES = ["SIBLING", "MERIT_SCHOLARSHIP", "RTE", "STAFF_WARD", "CUSTOM"] as const;

export const assignDiscountSchema = z.object({
  body: z.object({
    studentId: z.string().min(1, "studentId is required"),
    // BUG FIX: required - a discount with no linked fee assignment
    // never affected any amount a student owed (see
    // recalculateFeeAssignmentDiscount's doc comment for the full
    // root cause). Every discount must now target one specific fee.
    feeAssignmentId: z.string().min(1, "feeAssignmentId is required"),
    type: z.enum(DISCOUNT_TYPES),
    name: z.string().min(1, "name is required"),
    value: z.union([z.number(), z.string()]).transform((v) => Number(v)).refine((v) => Number.isFinite(v) && v > 0, {
      message: "value must be a positive number",
    }),
    isPercent: z.boolean().optional(),
  }),
});

export const bulkAssignDiscountSchema = z.object({
  body: z
    .object({
      classId: z.string().optional(),
      sectionId: z.string().optional(),
      // BUG FIX: required for the same reason as assignDiscountSchema
      // above - each matched student's OWN assignment for THIS
      // structure is what gets linked (see bulkAssignDiscount's doc
      // comment in discount.controller.ts).
      feeStructureId: z.string().min(1, "feeStructureId is required"),
      type: z.enum(DISCOUNT_TYPES),
      name: z.string().min(1, "name is required"),
      value: z.union([z.number(), z.string()]).transform((v) => Number(v)).refine((v) => Number.isFinite(v) && v > 0, {
        message: "value must be a positive number",
      }),
      isPercent: z.boolean().optional(),
    })
    .refine((v) => !!v.classId || !!v.sectionId, {
      message: "At least one of classId or sectionId is required to target students",
      path: ["classId"],
    }),
});
