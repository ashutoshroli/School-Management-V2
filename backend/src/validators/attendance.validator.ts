import { z } from "zod";

const ATTENDANCE_STATUS = ["PRESENT", "ABSENT", "HALF_DAY", "LATE", "ON_LEAVE"] as const;

// ===== Staff attendance =====

export const markStaffAttendanceSchema = z.object({
  body: z.object({
    staffId: z.string().min(1, "staffId is required"),
    date: z.coerce.date({ errorMap: () => ({ message: "Valid date is required" }) }),
    status: z.enum(ATTENDANCE_STATUS),
    inTime: z.coerce.date().optional(),
    outTime: z.coerce.date().optional(),
    remarks: z.string().optional(),
  }),
});

export const bulkMarkStaffAttendanceSchema = z.object({
  body: z.object({
    date: z.coerce.date({ errorMap: () => ({ message: "Valid date is required" }) }),
    records: z
      .array(
        z.object({
          staffId: z.string().min(1, "Every record must include staffId"),
          status: z.enum(ATTENDANCE_STATUS),
          remarks: z.string().optional(),
        })
      )
      .min(1, "records must be a non-empty array"),
  }),
});

// ===== Student attendance =====

export const markStudentAttendanceSchema = z.object({
  body: z.object({
    sectionId: z.string().min(1, "sectionId is required"),
    date: z.coerce.date({ errorMap: () => ({ message: "Valid date is required" }) }),
    period: z.number().int().min(1).max(8).optional().nullable(),
    records: z
      .array(
        z.object({
          studentId: z.string().min(1, "Every record must include studentId"),
          status: z.enum(ATTENDANCE_STATUS),
        })
      )
      .min(1, "records must be a non-empty array"),
  }),
});

// ===== Card-tap (device-authenticated, no user JWT) =====
// Deliberately lenient - the physical reader's payload is the thing
// being trusted here after apiKey verification inside the controller,
// not a user-driven form, so this only guards against a structurally
// malformed request, not business rules.
export const cardTapSchema = z.object({
  body: z.object({
    cardId: z.string().min(1, "cardId is required"),
    deviceId: z.string().min(1, "deviceId is required"),
    timestamp: z.coerce.date().optional(),
  }),
});
