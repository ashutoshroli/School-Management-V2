/**
 * TEMPORARY - see controllers/bootstrapAdmin.controller.ts's header
 * comment for the full rationale and safety checks. Delete this file
 * + its `router.use("/internal", bootstrapAdminRoutes)` line in
 * routes/index.ts + the controller + bootstrapAdminSchema once you've
 * successfully bootstrapped your first Super Admin and logged in.
 */
import { Router } from "express";
import { bootstrapAdmin } from "../controllers/bootstrapAdmin.controller";
import { validate } from "../middleware/validate";
import { bootstrapAdminSchema } from "../validators/bootstrapAdmin.validator";

const router = Router();

// POST /api/internal/bootstrap-admin
router.post("/bootstrap-admin", validate(bootstrapAdminSchema), bootstrapAdmin);

export default router;
