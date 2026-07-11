import { Router, Request, Response, NextFunction } from "express";
import passport from "passport";
import { login, googleCallback, getProfile, changePassword, switchBranch } from "../controllers/auth.controller";
import { uploadOwnAvatar } from "../controllers/upload.controller";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { uploadAvatar, handleUploadErrors } from "../middleware/upload";
import { loginSchema, changePasswordSchema, switchBranchSchema } from "../validators/auth.validator";
import { isGoogleOAuthConfigured } from "../config/passport";
import { sendError } from "../utils/response";

const router = Router();

// Credentials login (admin/teacher/accountant/staff)
router.post("/login", validate(loginSchema), login);

/**
 * Returns a clear 503 instead of letting passport.authenticate("google")
 * throw/500 when the "google" strategy was never registered (see
 * config/passport.ts's isGoogleOAuthConfigured guard) - relevant for
 * trial/demo deployments that skip Google OAuth setup and only use
 * email/password login.
 */
const requireGoogleOAuth = (req: Request, res: Response, next: NextFunction) => {
  if (!isGoogleOAuthConfigured()) {
    sendError(res, "Google sign-in is not configured on this server. Please use email/password login.", 503);
    return;
  }
  next();
};

// Google OAuth (student/parent)
router.get(
  "/google",
  requireGoogleOAuth,
  passport.authenticate("google", { scope: ["profile", "email"], session: false })
);

router.get(
  "/google/callback",
  requireGoogleOAuth,
  passport.authenticate("google", { session: false, failureRedirect: "/auth/failed" }),
  googleCallback
);

// Protected routes
router.get("/profile", authenticate, getProfile);
router.post("/switch-branch", authenticate, validate(switchBranchSchema), switchBranch);
router.put("/change-password", authenticate, validate(changePasswordSchema), changePassword);
router.post("/avatar", authenticate, handleUploadErrors(uploadAvatar), uploadOwnAvatar);

export default router;
