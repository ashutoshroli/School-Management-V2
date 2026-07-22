import { z } from "zod";

export const createHomeworkSchema = z.object({
  body: z.object({
    subjectId: z.string().min(1, "subjectId is required"),
    classId: z.string().min(1, "classId is required"),
    sectionId: z.string().optional(),
    title: z.string().min(1, "title is required"),
    description: z.string().optional(),
    attachmentUrl: z.string().optional(),
    dueDate: z.coerce.date({ errorMap: () => ({ message: "Valid dueDate is required" }) }),
  }),
});

export const updateHomeworkSchema = z.object({
  body: z.object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    attachmentUrl: z.string().optional(),
    dueDate: z.coerce.date().optional(),
  }),
});

export const submitHomeworkSchema = z.object({
  body: z.object({
    homeworkId: z.string().min(1, "homeworkId is required"),
    content: z.string().optional(),
    fileUrl: z.string().optional(),
  }),
});


export const gradeHomeworkSubmissionSchema = z.object({
  body: z.object({
    rating: z.number().int().min(1, "rating must be 1-5").max(5, "rating must be 1-5"),
    remarks: z.string().optional(),
  }),
});

export const raiseRecheckRequestSchema = z.object({
  body: z.object({
    homeworkSubmissionId: z.string().min(1, "homeworkSubmissionId is required"),
    reason: z.string().min(1, "reason is required"),
  }),
});

export const resolveOrEscalateRecheckRequestSchema = z.object({
  body: z.object({
    action: z.enum(["RESOLVE", "ESCALATE"]),
    remarks: z.string().optional(),
  }),
});

export const upsertRecheckEscalationConfigSchema = z.object({
  body: z.object({
    maxRequestsPerTeacherBeforeEscalation: z.number().int().min(1, "must be a positive whole number"),
  }),
});
