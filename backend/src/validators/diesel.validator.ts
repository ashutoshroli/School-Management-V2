import { z } from "zod";

const money = z.union([z.number(), z.string()]).transform((v) => Number(v)).refine((v) => Number.isFinite(v) && v >= 0, {
  message: "Must be a non-negative number",
});

export const raiseDieselRequestSchema = z.object({
  body: z.object({
    vehicleId: z.string().min(1, "vehicleId is required"),
    amount: money,
    litres: money,
  }),
});

export const advanceDieselRequestSchema = z.object({
  body: z.object({
    decision: z.enum(["APPROVE", "REJECT"]),
    rejectionReason: z.string().optional(),
    paymentMode: z.enum(["ONLINE_TRANSFER", "CASH"]).optional(),
  }),
});
