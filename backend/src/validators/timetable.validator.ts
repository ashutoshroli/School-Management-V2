import { z } from "zod";

export const getOrCreateTimetableSchema = z.object({
  body: z.object({
    sectionId: z.string().min(1, "sectionId is required"),
    classId: z.string().min(1, "classId is required"),
    academicYearId: z.string().min(1, "No active academic year found. Set an academic year as active first."),
  }),
});

export const upsertSlotSchema = z.object({
  body: z.object({
    timetableId: z.string().min(1, "timetableId is required"),
    day: z.enum(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"]),
    period: z.number().int().min(1, "period must be a positive integer"),
    subjectId: z.string().optional(),
    teacherId: z.string().optional(),
    startTime: z.string().min(1, "startTime is required"),
    endTime: z.string().min(1, "endTime is required"),
    isBreak: z.boolean().optional(),
  }),
});
