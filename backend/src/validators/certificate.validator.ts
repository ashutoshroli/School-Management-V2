import { z } from "zod";

export const generateCertificateSchema = z.object({
  body: z.object({
    templateId: z.string().min(1, "templateId is required"),
    studentId: z.string().min(1, "studentId is required"),
    // Only meaningful for Bonafide certificates (see
    // certificateGenerator.service.ts's renderBonafideCertificate) -
    // optional for the other certificate types.
    purpose: z.string().max(200).optional(),
  }),
});
