import { z } from "zod";

export const uploadGalleryImageSchema = z.object({
  body: z.object({
    branchId: z.string().optional(),
    title: z.string().optional(),
    imageUrl: z.string().min(1, "imageUrl is required"),
    category: z.string().optional(),
  }),
});

export const upsertRequirementsPageSchema = z.object({
  body: z.object({
    branchId: z.string().optional(),
    content: z.string().min(1, "content is required"),
  }),
});

export const reviewFeedbackSchema = z.object({
  body: z.object({
    reviewNotes: z.string().optional(),
  }),
});

export const submitPublicFeedbackSchema = z.object({
  body: z.object({
    branchId: z.string().min(1, "branchId is required"),
    name: z.string().min(1, "name is required").max(200),
    email: z.string().email("Valid email required"),
    phone: z.string().max(20).optional(),
    subject: z.string().max(200).optional(),
    message: z.string().min(1, "message is required").max(2000),
  }),
});
