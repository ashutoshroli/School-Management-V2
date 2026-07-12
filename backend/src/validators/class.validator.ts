import { z } from "zod";

export const bulkAssignSubjectToClassSchema = z.object({
  body: z.object({
    subjectId: z.string().min(1, "subjectId is required"),
    classIds: z.array(z.string().min(1)).min(1, "classIds must be a non-empty array"),
  }),
});
