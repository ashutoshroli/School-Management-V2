import { Router } from "express";
import {
  lookupPublicResults,
  lookupPublicFeeStatus,
  createPublicFeePaymentOrder,
  verifyPublicFeePayment,
  getPublicNotices,
  getPublicGallery,
  getPublicRequirements,
  submitPublicFeedback,
} from "../controllers/publicPortal.controller";
import { getPublicJobVacancies, applyToJobVacancy } from "../controllers/jobVacancy.controller";
import { validate } from "../middleware/validate";
import { publicLookupLimiter, publicSubmitLimiter } from "../middleware/rateLimiter";
import {
  publicLookupSchema,
  createPublicFeePaymentOrderSchema,
  verifyPublicFeePaymentSchema,
} from "../validators/publicPortal.validator";
import { applyToJobVacancySchema } from "../validators/jobVacancy.validator";
import { submitPublicFeedbackSchema } from "../validators/publicContent.validator";

/**
 * All routes in this file are PUBLIC (no `authenticate`) on purpose -
 * this is the write/read surface for the public landing page (result
 * lookup, fee status + online payment, careers, notice board). Every
 * identity-sensitive lookup (result, fee status/payment) is rate
 * limited via `publicLookupLimiter` (5/hour/IP - see
 * middleware/rateLimiter.ts's doc comment for why this is stricter
 * than the admission-inquiry limiter); plain public reads/submits
 * (notices, jobs) use the more generous `publicSubmitLimiter`
 * (10/hour/IP), matching admission.routes.ts's existing convention.
 */

const router = Router();

// Result lookup
router.post("/results/lookup", publicLookupLimiter, validate(publicLookupSchema), lookupPublicResults);

// Fee status lookup + online payment hand-off
router.post("/fees/lookup", publicLookupLimiter, validate(publicLookupSchema), lookupPublicFeeStatus);
router.post("/fees/pay", publicLookupLimiter, validate(createPublicFeePaymentOrderSchema), createPublicFeePaymentOrder);
router.post("/fees/verify", publicLookupLimiter, validate(verifyPublicFeePaymentSchema), verifyPublicFeePayment);

// Careers
router.get("/jobs", getPublicJobVacancies);
router.post("/jobs/:id/apply", publicSubmitLimiter, validate(applyToJobVacancySchema), applyToJobVacancy);

// Public notice board
router.get("/notices", getPublicNotices);

// Public Gallery, Requirements page, Feedback Form (spec Section 21)
router.get("/gallery", getPublicGallery);
router.get("/requirements/:branchId", getPublicRequirements);
router.post("/feedback", publicSubmitLimiter, validate(submitPublicFeedbackSchema), submitPublicFeedback);

export default router;
