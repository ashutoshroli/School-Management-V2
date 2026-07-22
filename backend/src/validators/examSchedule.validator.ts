import { z } from "zod";

const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

const scheduleEntrySchema = z.object({
  subjectId: z.string().min(1, "subjectId is required"),
  examDate: z.coerce.date(),
  startTime: z.string().regex(timeRegex, "startTime must be in HH:mm format"),
  endTime: z.string().regex(timeRegex, "endTime must be in HH:mm format"),
  durationMinutes: z.union([z.number(), z.string()]).transform((v) => Number(v)).refine((v) => Number.isFinite(v) && v > 0, {
    message: "durationMinutes must be a positive number",
  }),
  maxMarks: z.union([z.number(), z.string()]).transform((v) => Number(v)).refine((v) => Number.isFinite(v) && v > 0, {
    message: "maxMarks must be a positive number",
  }),
  roomId: z.string().optional(),
});

export const bulkSetExamScheduleSchema = z.object({
  body: z.object({
    examId: z.string().min(1, "examId is required"),
    schedule: z.array(scheduleEntrySchema).min(1, "schedule must be a non-empty array"),
  }),
});

export const updateExamScheduleEntrySchema = z.object({
  body: z.object({
    examDate: z.coerce.date().optional(),
    startTime: z.string().regex(timeRegex, "startTime must be in HH:mm format").optional(),
    endTime: z.string().regex(timeRegex, "endTime must be in HH:mm format").optional(),
    durationMinutes: z.union([z.number(), z.string()]).transform((v) => Number(v)).refine((v) => Number.isFinite(v) && v > 0, {
      message: "durationMinutes must be a positive number",
    }).optional(),
    maxMarks: z.union([z.number(), z.string()]).transform((v) => Number(v)).refine((v) => Number.isFinite(v) && v > 0, {
      message: "maxMarks must be a positive number",
    }).optional(),
    roomId: z.string().nullable().optional(),
  }),
});


export const assignInvigilatorSchema = z.object({
  body: z.object({
    examScheduleId: z.string().min(1, "examScheduleId is required"),
    staffId: z.string().min(1, "staffId is required"),
  }),
});
