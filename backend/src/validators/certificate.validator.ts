import { z } from "zod";

export const generateCertificateSchema = z.object({
  body: z.object({
    templateId: z.string().min(1, "templateId is required"),
    studentId: z.string().min(1, "studentId is required"),
    // Only meaningful for Bonafide certificates (see
    // certificateGenerator.service.ts's renderBonafideCertificate) -
    // optional for the other certificate types.
    purpose: z.string().max(200).optional(),
    // Free-form extra {{placeholder}} values for a CUSTOM certificate
    // template - a CUSTOM template's fields aren't known in advance
    // (unlike TRANSFER_CERTIFICATE/BONAFIDE/CHARACTER's fixed field
    // sets), so the admin supplies whatever additional key/value pairs
    // their uploaded .docx template needs at generation time (e.g.
    // {{eventName}}, {{awardTitle}}). Harmless to accept for the other
    // certificate types too - any keys not referenced by that
    // template's placeholders are simply ignored by docxtemplater.
    customFields: z.record(z.string().max(500)).optional(),
  }),
});
