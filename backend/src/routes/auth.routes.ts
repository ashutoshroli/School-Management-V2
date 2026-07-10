import { Router } from "express";
import passport from "passport";
import { login, googleCallback, getProfile, changePassword } from "../controllers/auth.controller";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { loginSchema, changePasswordSchema } from "../validators/auth.validator";

const router = Router();

// Credentials login (admin/teacher/accountant/staff)
router.post("/login", validate(loginSchema), login);

// Google OAuth (student/parent)
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"], session: false })
);

router.get(
  "/google/callback",
  passport.authenticate("google", { session: false, failureRedirect: "/auth/failed" }),
  googleCallback
);

// Protected routes
router.get("/profile", authenticate, getProfile);
router.put("/change-password", authenticate, validate(changePasswordSchema), changePassword);

export default router;
