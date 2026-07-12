import { z } from "zod";

export const publicLookupSchema = z.object({
  body: z.object({
    admissionNo: z.string().min(1, "admissionNo is required"),
    dateOfBirth: z.string().min(1, "dateOfBirth is required"),
  }),
});

export const createPublicFeePaymentOrderSchema = z.object({
  body: z.object({
    admissionNo: z.string().min(1, "admissionNo is required"),
    dateOfBirth: z.string().min(1, "dateOfBirth is required"),
    feeAssignmentId: z.string().min(1, "feeAssignmentId is required"),
  }),
});

export const verifyPublicFeePaymentSchema = z.object({
  body: z.object({
    admissionNo: z.string().min(1, "admissionNo is required"),
    dateOfBirth: z.string().min(1, "dateOfBirth is required"),
    feeAssignmentId: z.string().min(1, "feeAssignmentId is required"),
    razorpay_order_id: z.string().min(1, "razorpay_order_id is required"),
    razorpay_payment_id: z.string().min(1, "razorpay_payment_id is required"),
    razorpay_signature: z.string().min(1, "razorpay_signature is required"),
  }),
});
