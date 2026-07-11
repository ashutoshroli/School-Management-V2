import { z } from "zod";

export const bulkPromoteSchema = z.object({
  body: z.object({
    academicYearId: z.string().min(1, "academicYearId is required"),
    fromClassId: z.string().min(1, "fromClassId is required"),
    // Optional - when omitted, every active student in the whole
    // fromClassId (across all its sections) is considered.
    fromSectionId: z.string().optional(),
    toClassId: z.string().min(1, "toClassId is required"),
    // Required (no fallback) - see promotion.controller.ts's doc
    // comment on bulkPromote for why defaulting this to the student's
    // existing section used to produce inconsistent class/section data.
    toSectionId: z.string().min(1, "toSectionId is required"),
    detainedStudentIds: z.array(z.string().min(1)).optional(),
    tcIssuedStudentIds: z.array(z.string().min(1)).optional(),
  }),
});
