import { Router, Request, Response, NextFunction } from "express";
import passport from "passport";
import { login, googleCallback, getProfile, changePassword, switchBranch, forgotPassword, resetPasswordHandler } from "../controllers/auth.controller";
import { uploadOwnAvatar } from "../controllers/upload.controller";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { uploadAvatar, handleUploadErrors } from "../middleware/upload";
import { loginSchema, changePasswordSchema, switchBranchSchema, forgotPasswordSchema, resetPasswordSchema } from "../validators/auth.validator";
import { isGoogleOAuthConfigured } from "../config/passport";
import { sendError } from "../utils/response";

const router = Router();

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Login with email/password
 *     description: Credentials login for admin/teacher/accountant/staff roles. Students/parents typically use Google OAuth instead (see /auth/google).
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/LoginResponseData'
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
// Credentials login (admin/teacher/accountant/staff)
router.post("/login", validate(loginSchema), login);

// Password reset (public, no auth)
router.post("/forgot-password", validate(forgotPasswordSchema), forgotPassword);
router.post("/reset-password", validate(resetPasswordSchema), resetPasswordHandler);

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

/**
 * @swagger
 * /auth/profile:
 *   get:
 *     summary: Get the current logged-in user's profile
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Current user's profile
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/UserSummary'
 *       401:
 *         description: Missing/invalid token
 */
// Protected routes
router.get("/profile", authenticate, getProfile);

/**
 * @swagger
 * /auth/switch-branch:
 *   post:
 *     summary: Switch the current session's active branch
 *     description: For SUPER_ADMIN users (or any user with access to multiple branches) - changes which branch subsequent requests are scoped to.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SwitchBranchRequest'
 *     responses:
 *       200:
 *         description: Branch switched
 *       403:
 *         description: No access to the requested branch
 */
router.post("/switch-branch", authenticate, validate(switchBranchSchema), switchBranch);

/**
 * @swagger
 * /auth/change-password:
 *   put:
 *     summary: Change the current user's password
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChangePasswordRequest'
 *     responses:
 *       200:
 *         description: Password changed
 *       400:
 *         description: Current password incorrect, or new password doesn't meet requirements
 */
router.put("/change-password", authenticate, validate(changePasswordSchema), changePassword);

/**
 * @swagger
 * /auth/avatar:
 *   post:
 *     summary: Upload/replace the current user's profile photo
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Avatar updated
 *       400:
 *         description: No file uploaded / invalid file type
 */
router.post("/avatar", authenticate, handleUploadErrors(uploadAvatar), uploadOwnAvatar);

export default router;
