import { z } from "zod";

export const createNoticeSchema = z.object({
  body: z.object({
    // Optional - resolved server-side, see resolveEffectiveBranchId.
    branchId: z.string().optional(),
    title: z.string().min(1, "title is required"),
    body: z.string().min(1, "body is required"),
    type: z.enum(["ALL", "STUDENTS", "PARENTS", "TEACHERS", "STAFF", "CLASS_SPECIFIC"]),
    targetClass: z.string().optional(),
    attachmentUrl: z.string().optional(),
    isPinned: z.boolean().optional(),
    isPublic: z.boolean().optional(),
    expiryDate: z.coerce.date().optional(),
  }),
});
