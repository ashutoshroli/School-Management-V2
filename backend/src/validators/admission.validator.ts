import { z } from "zod";

export const createAdmissionInquirySchema = z.object({
  body: z.object({
    branchId: z.string().min(1, "branchId is required"),
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
  }),
});

export const updateAdmissionInquiryStatusSchema = z.object({
  body: z.object({
    status: z.enum(["NEW", "CONTACTED", "ADMITTED", "REJECTED"]),
    reviewNotes: z.string().max(1000).optional(),
  }),
});
