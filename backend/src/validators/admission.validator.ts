import { z } from "zod";

export const createAdmissionInquirySchema = z.object({
  body: z.object({
    // branchId kept for backward compatibility (single-branch caller);
    // branchPriorityIds is the new multi-branch checklist (spec
    // Section 21) - at least one of the two must be usable, enforced
    // in the controller (falls back to [branchId] when omitted).
    branchId: z.string().optional(),
    branchPriorityIds: z.array(z.string().min(1)).min(1).optional(),
    studentName: z.string().min(1, "Student name is required").max(200),
    dateOfBirth: z.coerce.date({ errorMap: () => ({ message: "Valid dateOfBirth is required" }) }),
    gender: z.enum(["MALE", "FEMALE", "OTHER"]),
    classAppliedFor: z.string().min(1, "classAppliedFor is required"),
    parentName: z.string().min(1, "Parent/guardian name is required").max(200),
    parentEmail: z.string().email("Valid email required"),
    parentPhone: z.string().min(6, "Valid phone number required").max(20),
    address: z.string().max(500).optional(),
    previousSchool: z.string().max(200).optional(),
    message: z.string().max(1000).optional(),
  }).refine((v) => !!v.branchId || (v.branchPriorityIds && v.branchPriorityIds.length > 0), {
    message: "Either branchId or branchPriorityIds is required",
    path: ["branchId"],
  }),
});

export const updateAdmissionInquiryStatusSchema = z.object({
  body: z.object({
    status: z.enum(["NEW", "CONTACTED", "ENTRANCE_TEST_SCHEDULED", "ADMITTED", "REJECTED"]),
    reviewNotes: z.string().max(1000).optional(),
  }),
});

export const recordEntranceTestResultSchema = z.object({
  body: z.object({
    admissionInquiryId: z.string().optional(),
    studentId: z.string().optional(),
    testDate: z.coerce.date({ errorMap: () => ({ message: "Valid testDate is required" }) }),
    score: z.union([z.number(), z.string()]).transform((v) => Number(v)),
    maxScore: z.union([z.number(), z.string()]).transform((v) => Number(v)),
    remarks: z.string().optional(),
  }).refine((v) => !!v.admissionInquiryId || !!v.studentId, {
    message: "Either admissionInquiryId or studentId is required",
    path: ["admissionInquiryId"],
  }),
});
