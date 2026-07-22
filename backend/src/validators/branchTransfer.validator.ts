import { z } from "zod";

export const initiateStudentTransferSchema = z.object({
  body: z.object({
    studentId: z.string().min(1, "studentId is required"),
    destinationBranchId: z.string().min(1, "destinationBranchId is required"),
  }),
});

export const respondToTransferSchema = z.object({
  body: z.object({
    decision: z.enum(["APPROVE", "REJECT"]),
    rejectionReason: z.string().optional(),
  }),
});

export const decideFeeDuesSchema = z.object({
  body: z.object({
    feeDuesOption: z.enum(["CARRY_FORWARD", "CLEAR_DUES_AND_ADMIT", "CLEAR_AT_OLD_BRANCH"]),
  }),
});

export const initiateStaffTransferSchema = z.object({
  body: z.object({
    staffId: z.string().min(1, "staffId is required"),
    destinationBranchId: z.string().min(1, "destinationBranchId is required"),
  }),
});
