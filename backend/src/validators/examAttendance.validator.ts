import { z } from "zod";

const recordSchema = z.object({
  studentId: z.string().min(1, "studentId is required"),
  status: z.enum(["PRESENT", "ABSENT", "UNFAIR_MEANS", "LATE"]),
  remarks: z.string().optional(),
});

export const markExamAttendanceSchema = z.object({
  body: z.object({
    roomId: z.string().optional(),
    records: z.array(recordSchema).min(1, "records must be a non-empty array"),
  }),
});
