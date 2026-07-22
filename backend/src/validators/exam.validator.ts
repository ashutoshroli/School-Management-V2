import { z } from "zod";

export const createExamSchema = z.object({
  body: z.object({
    academicYearId: z.string().min(1, "academicYearId is required"),
    classId: z.string().min(1, "classId is required"),
    // Creation-rights scoping (spec Section 9) - a Class Teacher passes
    // sectionId, a Subject Teacher passes subjectId; a Principal/Admin
    // may leave both empty for a whole-class exam.
    sectionId: z.string().optional(),
    subjectId: z.string().optional(),
    name: z.string().min(1, "name is required"),
    type: z.enum(["UNIT_TEST", "HALF_YEARLY", "ANNUAL", "PRE_BOARD", "PRACTICAL", "INTERNAL"]),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
  }),
});

export const createPostponementRequestSchema = z.object({
  body: z.object({
    examId: z.string().min(1, "examId is required"),
    affectedStaffId: z.string().min(1, "affectedStaffId is required"),
    reason: z.string().optional(),
    respondDeadline: z.coerce.date({ errorMap: () => ({ message: "Valid respondDeadline is required" }) }),
  }),
});

export const acknowledgePostponementRequestSchema = z.object({
  body: z.object({
    newExamDate: z.coerce.date().optional(),
  }),
});

export const upsertReportCardWeightageSchema = z.object({
  body: z.object({
    branchId: z.string().min(1, "branchId is required"),
    examType: z.enum(["UNIT_TEST", "HALF_YEARLY", "ANNUAL", "PRE_BOARD", "PRACTICAL", "INTERNAL"]),
    weightPct: z.union([z.number(), z.string()]).transform((v) => Number(v)),
  }),
});

export const updateExamSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    type: z.enum(["UNIT_TEST", "HALF_YEARLY", "ANNUAL", "PRE_BOARD", "PRACTICAL", "INTERNAL"]).optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
  }),
});

export const enterMarksSchema = z.object({
  body: z.object({
    examId: z.string().min(1, "examId is required"),
    subjectId: z.string().min(1, "subjectId is required"),
    marks: z
      .array(
        z.object({
          studentId: z.string().min(1, "Every mark entry must include studentId"),
          maxMarks: z.union([z.number(), z.string()]).transform((v) => Number(v)).refine((v) => Number.isFinite(v) && v > 0, {
            message: "maxMarks must be a positive number",
          }),
          obtainedMarks: z.union([z.number(), z.string()]).transform((v) => Number(v)).refine((v) => Number.isFinite(v) && v >= 0, {
            message: "obtainedMarks must be a non-negative number",
          }),
        })
      )
      .min(1, "marks must be a non-empty array"),
  }),
});
