import { z } from "zod";

const positiveAmount = z
  .union([z.number(), z.string()])
  .transform((v) => Number(v))
  .refine((v) => Number.isFinite(v) && v > 0, { message: "Amount must be a positive number" });

export const createAccountSchema = z.object({
  body: z.object({
    branchId: z.string().min(1, "branchId is required"),
    name: z.string().min(1, "Account name is required"),
    code: z.string().min(1, "Account code is required"),
    type: z.enum(["ASSET", "LIABILITY", "INCOME", "EXPENSE", "CAPITAL"]),
    parentId: z.string().optional(),
  }),
});

const voucherEntrySchema = z.object({
  debitAccountId: z.string().min(1, "debitAccountId is required"),
  creditAccountId: z.string().min(1, "creditAccountId is required"),
  amount: positiveAmount,
  narration: z.string().optional(),
});

export const createVoucherSchema = z.object({
  body: z.object({
    branchId: z.string().min(1, "branchId is required"),
    type: z.enum(["PAYMENT", "RECEIPT", "JOURNAL", "CONTRA"]),
    date: z.coerce.date({ errorMap: () => ({ message: "Valid date is required" }) }),
    narration: z.string().optional(),
    entries: z.array(voucherEntrySchema).min(1, "At least one entry is required"),
  }),
});
