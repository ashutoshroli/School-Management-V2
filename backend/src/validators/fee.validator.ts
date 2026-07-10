import { z } from "zod";

const positiveAmount = z
  .union([z.number(), z.string()])
  .transform((v) => Number(v))
  .refine((v) => Number.isFinite(v) && v > 0, { message: "Amount must be a positive number" });

export const collectPaymentSchema = z.object({
  body: z.object({
    branchId: z.string().min(1, "branchId is required"),
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

export const createRazorpayOrderSchema = z.object({
  body: z.object({
    branchId: z.string().min(1, "branchId is required"),
    studentId: z.string().min(1, "studentId is required"),
    feeAssignmentId: z.string().min(1, "feeAssignmentId is required"),
  }),
});

export const verifyRazorpayPaymentSchema = z.object({
  body: z.object({
    branchId: z.string().min(1, "branchId is required"),
    studentId: z.string().min(1, "studentId is required"),
    feeAssignmentId: z.string().min(1, "feeAssignmentId is required"),
    razorpay_order_id: z.string().min(1, "razorpay_order_id is required"),
    razorpay_payment_id: z.string().min(1, "razorpay_payment_id is required"),
    razorpay_signature: z.string().min(1, "razorpay_signature is required"),
  }),
});
