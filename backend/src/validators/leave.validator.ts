import { z } from "zod";

export const applyLeaveSchema = z.object({
  body: z.object({
    leaveTypeId: z.string().min(1, "leaveTypeId is required"),
    fromDate: z.coerce.date({ errorMap: () => ({ message: "Valid fromDate is required" }) }),
    toDate: z.coerce.date({ errorMap: () => ({ message: "Valid toDate is required" }) }),
    reason: z.string().min(1, "reason is required"),
  }),
});

export const updateLeaveStatusSchema = z.object({
  body: z.object({
    status: z.enum(["APPROVED", "REJECTED"]),
    remarks: z.string().optional(),
  }),
});

export const bulkUpdateLeaveStatusSchema = z.object({
  body: z.object({
    applicationIds: z.array(z.string().min(1)).min(1, "applicationIds must be a non-empty array"),
    status: z.enum(["APPROVED", "REJECTED"]),
    remarks: z.string().optional(),
  }),
});

export const createLeaveTypeSchema = z.object({
  body: z.object({
    name: z.string().min(1, "name is required"),
    code: z.string().min(1, "code is required"),
    maxDays: z.union([z.number(), z.string()]).transform((v) => Number(v)).refine((v) => Number.isInteger(v) && v > 0, {
      message: "maxDays must be a positive whole number",
    }),
    carryForward: z.boolean().optional(),
  }),
});

export const updateLeaveTypeSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    maxDays: z.union([z.number(), z.string()]).transform((v) => Number(v)).refine((v) => Number.isInteger(v) && v > 0, {
      message: "maxDays must be a positive whole number",
    }).optional(),
    carryForward: z.boolean().optional(),
    isActive: z.boolean().optional(),
  }),
});
