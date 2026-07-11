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
