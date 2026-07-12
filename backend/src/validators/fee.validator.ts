import { z } from "zod";

const positiveAmount = z
  .union([z.number(), z.string()])
  .transform((v) => Number(v))
  .refine((v) => Number.isFinite(v) && v > 0, { message: "Amount must be a positive number" });

export const collectPaymentSchema = z.object({
  body: z.object({
    // Optional: collectPayment resolves the effective branchId
    // server-side (resolveEffectiveBranchId) and falls back to the
    // caller's own branch if this is ever missing/blank - matches the
    // rest of the create-X endpoints fixed for the same reason.
    branchId: z.string().optional(),
    studentId: z.string().min(1, "studentId is required"),
    feeAssignmentId: z.string().min(1, "feeAssignmentId is required"),
    amount: positiveAmount,
    paymentMode: z.enum(["CASH", "CHEQUE", "DD", "ONLINE_RAZORPAY", "ONLINE_PAYU", "UPI", "BANK_TRANSFER"]),
    transactionId: z.string().optional(),
    chequeNo: z.string().optional(),
    chequeDate: z.coerce.date().optional(),
    bankName: z.string().optional(),
    remarks: z.string().optional(),
    waiveLateFee: z.boolean().optional(),
  }),
});

export const createRefundSchema = z.object({
  body: z.object({
    paymentId: z.string().min(1, "paymentId is required"),
    amount: positiveAmount,
    reason: z.string().min(1, "reason is required"),
  }),
});

export const bulkAssignFeesSchema = z.object({
  body: z.object({
    feeStructureId: z.string().min(1, "feeStructureId is required"),
    classId: z.string().min(1, "classId is required"),
    sectionId: z.string().optional(),
  }),
});

export const assignFeesToStudentsSchema = z.object({
  body: z.object({
    feeStructureId: z.string().min(1, "feeStructureId is required"),
    studentIds: z.array(z.string().min(1)).min(1, "studentIds must be a non-empty array"),
  }),
});

export const assignTransportFeeSchema = z.object({
  body: z.object({
    routeId: z.string().min(1, "routeId is required"),
    academicYearId: z.string().min(1, "academicYearId is required"),
  }),
});

export const assignTransportFeeToStudentsSchema = z.object({
  body: z.object({
    routeId: z.string().min(1, "routeId is required"),
    academicYearId: z.string().min(1, "academicYearId is required"),
    studentIds: z.array(z.string().min(1)).min(1, "studentIds must be a non-empty array"),
  }),
});

export const bulkCreateFeeStructureSchema = z.object({
  body: z.object({
    branchId: z.string().optional(),
    academicYearId: z.string().min(1, "academicYearId is required"),
    classIds: z.array(z.string().min(1)).min(1, "classIds must be a non-empty array"),
    feeCategoryId: z.string().min(1, "feeCategoryId is required"),
    amount: positiveAmount,
    frequency: z.enum(["MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY", "ONE_TIME"]),
    dueDay: z.number().int().min(1).max(28).optional(),
    lateFeeType: z.enum(["NONE", "FIXED", "PERCENTAGE"]).optional(),
    lateFeeValue: z.union([z.number(), z.string()]).transform((v) => Number(v)).optional(),
    installments: z
      .array(
        z.object({
          installmentNo: z.number().int().min(1),
          amount: positiveAmount,
          dueDate: z.coerce.date(),
        })
      )
      .optional(),
  }),
});

export const createRazorpayOrderSchema = z.object({
  body: z.object({
    // Optional - see collectPaymentSchema's comment above.
    branchId: z.string().optional(),
    studentId: z.string().min(1, "studentId is required"),
    feeAssignmentId: z.string().min(1, "feeAssignmentId is required"),
  }),
});

export const verifyRazorpayPaymentSchema = z.object({
  body: z.object({
    // Optional - see collectPaymentSchema's comment above.
    branchId: z.string().optional(),
    studentId: z.string().min(1, "studentId is required"),
    feeAssignmentId: z.string().min(1, "feeAssignmentId is required"),
    razorpay_order_id: z.string().min(1, "razorpay_order_id is required"),
    razorpay_payment_id: z.string().min(1, "razorpay_payment_id is required"),
    razorpay_signature: z.string().min(1, "razorpay_signature is required"),
  }),
});
