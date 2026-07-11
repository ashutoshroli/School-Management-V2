import { z } from "zod";

// GradeSystem has no branchId in the schema (see db/prisma/schema.prisma) -
// grade bands are a single, system-wide scale shared by every branch,
// same as LeaveType. minMarks must be strictly less than maxMarks so a
// band can never be degenerate/inverted, and both must be within the
// realistic 0-100 percentage-style range every other percentage field
// in this codebase already assumes (see Mark.maxMarks/obtainedMarks).
export const createGradeBandSchema = z.object({
  body: z
    .object({
      name: z.string().min(1, "name is required"),
      minMarks: z.union([z.number(), z.string()]).transform((v) => Number(v)).refine((v) => Number.isFinite(v) && v >= 0 && v <= 100, {
        message: "minMarks must be a number between 0 and 100",
      }),
      maxMarks: z.union([z.number(), z.string()]).transform((v) => Number(v)).refine((v) => Number.isFinite(v) && v >= 0 && v <= 100, {
        message: "maxMarks must be a number between 0 and 100",
      }),
      grade: z.string().min(1, "grade is required"),
      gradePoint: z.union([z.number(), z.string()]).transform((v) => Number(v)).refine((v) => Number.isFinite(v) && v >= 0, {
        message: "gradePoint must be a non-negative number",
      }).optional(),
    })
    .refine((v) => v.minMarks < v.maxMarks, { message: "minMarks must be less than maxMarks", path: ["minMarks"] }),
});

export const updateGradeBandSchema = z.object({
  body: z
    .object({
      name: z.string().min(1).optional(),
      minMarks: z.union([z.number(), z.string()]).transform((v) => Number(v)).refine((v) => Number.isFinite(v) && v >= 0 && v <= 100, {
        message: "minMarks must be a number between 0 and 100",
      }).optional(),
      maxMarks: z.union([z.number(), z.string()]).transform((v) => Number(v)).refine((v) => Number.isFinite(v) && v >= 0 && v <= 100, {
        message: "maxMarks must be a number between 0 and 100",
      }).optional(),
      grade: z.string().min(1).optional(),
      gradePoint: z.union([z.number(), z.string()]).transform((v) => Number(v)).refine((v) => Number.isFinite(v) && v >= 0, {
        message: "gradePoint must be a non-negative number",
      }).optional(),
    })
    .refine((v) => v.minMarks === undefined || v.maxMarks === undefined || v.minMarks < v.maxMarks, {
      message: "minMarks must be less than maxMarks",
      path: ["minMarks"],
    }),
});
