import { z } from "zod";

const DISCOUNT_TYPES = ["SIBLING", "STAFF_WARD", "MERIT", "RTE", "FINANCIAL_HARDSHIP", "OTHER"] as const;

export const bulkAssignDiscountSchema = z.object({
  body: z
    .object({
      classId: z.string().optional(),
      sectionId: z.string().optional(),
      type: z.enum(DISCOUNT_TYPES),
      name: z.string().min(1, "name is required"),
      value: z.union([z.number(), z.string()]).transform((v) => Number(v)).refine((v) => Number.isFinite(v) && v > 0, {
        message: "value must be a positive number",
      }),
      isPercent: z.boolean().optional(),
    })
    .refine((v) => !!v.classId || !!v.sectionId, {
      message: "At least one of classId or sectionId is required to target students",
      path: ["classId"],
    }),
});
