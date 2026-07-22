import { z } from "zod";

const score = z.union([z.number(), z.string()]).transform((v) => Number(v)).refine((v) => Number.isFinite(v) && v >= 0, {
  message: "Must be a non-negative number",
});

export const submitAppraisalRatingSchema = z.object({
  body: z.object({
    subjectStaffId: z.string().min(1, "subjectStaffId is required"),
    source: z.enum(["STUDENT_WEEKLY", "PARENT_POST_PTM", "PRINCIPAL_TEACHER_MUTUAL", "VP_TEACHER_MUTUAL", "ATTENDANCE_PERFORMANCE"]),
    raterStaffId: z.string().optional(),
    raterStudentId: z.string().optional(),
    score,
    maxScore: score,
    feedback: z.string().optional(),
    periodLabel: z.string().min(1, "periodLabel is required"),
  }),
});

export const enterIncrementSchema = z.object({
  body: z.object({
    staffId: z.string().min(1, "staffId is required"),
    periodLabel: z.string().min(1, "periodLabel is required"),
    incrementPct: z.union([z.number(), z.string()]).transform((v) => Number(v)),
    notes: z.string().optional(),
  }),
});
