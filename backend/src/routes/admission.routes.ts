import { Router } from "express";
import rateLimit from "express-rate-limit";
import { UserRole } from "@prisma/client";
import { createAdmissionInquiry, getAdmissionInquiries, getAdmissionInquiryById, updateAdmissionInquiryStatus, getPublicBranchList, getAdmissionInquiryPdf, deleteAdmissionInquiry, recordEntranceTestResult } from "../controllers/admission.controller";
import { authenticate, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { createAdmissionInquirySchema, updateAdmissionInquiryStatusSchema, recordEntranceTestResultSchema } from "../validators/admission.validator";

const router = Router();
const ADMIN = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN];

// Stricter rate limit than the general /api/auth limiter - this is a
// fully public, unauthenticated endpoint with no CAPTCHA, so it's a
// realistic spam/abuse target. 10 submissions per hour per IP is
// generous for a genuine applicant (who submits once) while making
// automated spam impractical.
const inquiryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { success: false, message: "Too many inquiries submitted. Please try again later." },
});

// PUBLIC - no authenticate() here on purpose.
router.get("/branches", getPublicBranchList);
router.post("/inquiries", inquiryLimiter, validate(createAdmissionInquirySchema), createAdmissionInquiry);

// Staff-only from here down.
router.get("/inquiries", authenticate, authorize(...ADMIN), getAdmissionInquiries);
router.get("/inquiries/:id", authenticate, authorize(...ADMIN), getAdmissionInquiryById);
router.get("/inquiries/:id/pdf", authenticate, authorize(...ADMIN), getAdmissionInquiryPdf);
router.patch("/inquiries/:id/status", authenticate, authorize(...ADMIN), validate(updateAdmissionInquiryStatusSchema), updateAdmissionInquiryStatus);
router.delete("/inquiries/:id", authenticate, authorize(...ADMIN), deleteAdmissionInquiry);
// Entrance test (spec Section 18 - applies to ALL classes)
router.post("/entrance-test", authenticate, authorize(...ADMIN), validate(recordEntranceTestResultSchema), recordEntranceTestResult);

export default router;
