import rateLimit from "express-rate-limit";

/**
 * Shared rate-limiter factory for public (no-auth) endpoints. Previously
 * every router that needed one (see admission.routes.ts's `inquiryLimiter`)
 * declared its own `rateLimit({...})` call inline - centralized here so
 * new public endpoints (job applications, result/fee lookups) don't each
 * redeclare the same shape, and so the messaging stays consistent.
 */
export const createPublicLimiter = (windowMs: number, max: number, message: string) =>
  rateLimit({
    windowMs,
    max,
    message: { success: false, message },
  });

/**
 * Stricter than the admission-inquiry limiter (10/hour) - a public
 * lookup by admissionNo + dateOfBirth is a real enumeration target
 * against a real student's academic/financial data, not just a spam
 * target like a lead-generation form. 5/hour/IP is generous for a
 * genuine parent/student checking their own result or dues (who
 * succeeds on the first or second try) while making brute-force
 * guessing of admission numbers impractical.
 */
export const publicLookupLimiter = createPublicLimiter(
  60 * 60 * 1000,
  5,
  "Too many lookup attempts. Please try again later."
);

/**
 * Same generosity as the admission-inquiry limiter (10/hour/IP) - a
 * job application or a public notice-board view are simple public
 * reads/submits, not a sensitive-data-enumeration target.
 */
export const publicSubmitLimiter = createPublicLimiter(
  60 * 60 * 1000,
  10,
  "Too many submissions. Please try again later."
);
