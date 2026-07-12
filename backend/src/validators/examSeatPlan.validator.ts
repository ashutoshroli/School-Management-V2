import { z } from "zod";

export const generateSeatPlanSchema = z.object({
  body: z.object({
    roomIds: z.array(z.string().min(1)).min(1, "roomIds must be a non-empty array"),
    arrangement: z.enum(["ROLL_NO_ORDER", "ALTERNATE_GENDER"]).default("ROLL_NO_ORDER"),
    sectionIds: z.array(z.string().min(1)).optional(),
    gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
    rollNoFrom: z.string().optional(),
    rollNoTo: z.string().optional(),
  }),
});
