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
