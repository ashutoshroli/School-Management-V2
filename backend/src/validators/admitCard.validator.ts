import { z } from "zod";

const ruleConfigSchema = z
  .object({
    minAttendancePercent: z.number().min(0).max(100).optional(),
    attendanceFrom: z.string().optional(),
    attendanceTo: z.string().optional(),
    feesClearedTillMonth: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "feesClearedTillMonth must be in YYYY-MM format")
      .optional(),
  })
  .optional();

export const generateAdmitCardSchema = z.object({
  body: z.object({
    studentId: z.string().min(1, "studentId is required"),
    ruleConfig: ruleConfigSchema,
    onIneligible: z.enum(["DENY", "PROVISIONAL"]).optional(),
    provisionalSubjectIds: z.array(z.string()).optional(),
  }),
});

export const bulkGenerateAdmitCardsSchema = z.object({
  body: z.object({
    ruleConfig: ruleConfigSchema,
    onIneligible: z.enum(["DENY", "PROVISIONAL"]).optional(),
  }),
});
