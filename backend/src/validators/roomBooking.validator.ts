import { z } from "zod";

export const requestRoomBookingSchema = z.object({
  body: z.object({
    branchId: z.string().optional(),
    roomId: z.string().min(1, "roomId is required"),
    purpose: z.string().min(1, "purpose is required"),
    startTime: z.coerce.date({ errorMap: () => ({ message: "Valid startTime is required" }) }),
    endTime: z.coerce.date({ errorMap: () => ({ message: "Valid endTime is required" }) }),
  }),
});

export const respondToRoomBookingSchema = z.object({
  body: z.object({
    decision: z.enum(["APPROVE", "REJECT"]),
    rejectionReason: z.string().optional(),
  }),
});
