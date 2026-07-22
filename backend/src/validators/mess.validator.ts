import { z } from "zod";

const money = z.union([z.number(), z.string()]).transform((v) => Number(v)).refine((v) => Number.isFinite(v) && v >= 0, {
  message: "Must be a non-negative number",
});

export const upsertMessMenuSchema = z.object({
  body: z.object({
    branchId: z.string().optional(),
    dayOfWeek: z.enum(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"]),
    mealType: z.enum(["BREAKFAST", "LUNCH", "DINNER", "SNACKS"]),
    vegOption: z.string().min(1, "vegOption is required"),
    nonVegOption: z.string().optional(),
  }),
});

export const advanceMenuApprovalSchema = z.object({
  body: z.object({
    decision: z.enum(["APPROVE", "REJECT"]),
  }),
});

export const generateMessBillSchema = z.object({
  body: z.object({
    branchId: z.string().optional(),
    studentId: z.string().min(1, "studentId is required"),
    month: z.number().int().min(1).max(12),
    year: z.number().int().min(2000),
    amount: money,
  }),
});

export const waiveMessBillSchema = z.object({
  body: z.object({
    waivedAmount: money,
    waivedViaLeaveApplicationId: z.string().optional(),
  }),
});

export const logGuestMealSchema = z.object({
  body: z.object({
    branchId: z.string().optional(),
    guestName: z.string().min(1, "guestName is required"),
    isParent: z.boolean().optional(),
    relatedStudentId: z.string().optional(),
    mealType: z.enum(["BREAKFAST", "LUNCH", "DINNER", "SNACKS"]),
    chargeAmount: money.optional(),
  }),
});
