import { z } from "zod";

export const createJobVacancySchema = z.object({
  body: z.object({
    branchId: z.string().optional(),
    title: z.string().min(1, "title is required"),
    department: z.string().optional(),
    description: z.string().min(1, "description is required"),
    qualifications: z.string().optional(),
    closingDate: z.coerce.date().optional(),
  }),
});

export const updateJobVacancySchema = z.object({
  body: z.object({
    title: z.string().optional(),
    department: z.string().optional(),
    description: z.string().optional(),
    qualifications: z.string().optional(),
    closingDate: z.coerce.date().nullable().optional(),
    isActive: z.boolean().optional(),
  }),
});

export const applyToJobVacancySchema = z.object({
  body: z.object({
    applicantName: z.string().min(1, "applicantName is required"),
    email: z.string().email("A valid email is required"),
    phone: z.string().min(1, "phone is required"),
    resumeUrl: z.string().optional(),
    coverNote: z.string().optional(),
  }),
});

export const updateJobApplicationStatusSchema = z.object({
  body: z.object({
    status: z.enum(["NEW", "SHORTLISTED", "REJECTED", "HIRED"]),
    reviewNotes: z.string().optional(),
  }),
});
