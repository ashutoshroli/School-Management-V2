import { z } from "zod";

const money = z.union([z.number(), z.string()]).transform((v) => Number(v)).refine((v) => Number.isFinite(v) && v >= 0, {
  message: "Must be a non-negative number",
});

export const upsertSalaryStructureSchema = z.object({
  body: z.object({
    staffId: z.string().min(1, "staffId is required"),
    basic: money,
    da: money.optional(),
    hra: money.optional(),
    ta: money.optional(),
    specialAllow: money.optional(),
    medicalAllow: money.optional(),
    otherAllow: money.optional(),
    professionalTax: money.optional(),
    otherDeduction: money.optional(),
    taxRegime: z.enum(["OLD", "NEW"]).optional(),
  }),
});

/**
 * Shared "salary template" fields for both bulk-assignment endpoints
 * below - same shape as upsertSalaryStructureSchema minus staffId
 * (which each endpoint supplies differently: filters vs. an explicit list).
 */
const salaryTemplateFields = {
  basic: money,
  da: money.optional(),
  hra: money.optional(),
  ta: money.optional(),
  specialAllow: money.optional(),
  medicalAllow: money.optional(),
  otherAllow: money.optional(),
  professionalTax: money.optional(),
  otherDeduction: money.optional(),
  taxRegime: z.enum(["OLD", "NEW"]).optional(),
  // If true, staff who already have a salary structure get it
  // overwritten with this template too, instead of being skipped.
  overwriteExisting: z.boolean().optional(),
};

export const bulkAssignSalaryStructureSchema = z.object({
  body: z.object({
    branchId: z.string().optional(),
    type: z.enum(["TEACHING", "NON_TEACHING"]).optional(),
    department: z.string().optional(),
    designation: z.string().optional(),
    ...salaryTemplateFields,
  }),
});

export const assignSalaryStructureToStaffSchema = z.object({
  body: z.object({
    staffIds: z.array(z.string().min(1)).min(1, "staffIds must be a non-empty array"),
    ...salaryTemplateFields,
  }),
});

export const runPayrollSchema = z.object({
  body: z.object({
    branchId: z.string().optional(),
    month: z.coerce.number().int().min(1, "month must be 1-12").max(12, "month must be 1-12"),
    year: z.coerce.number().int().min(2000, "Invalid year"),
  }),
});
