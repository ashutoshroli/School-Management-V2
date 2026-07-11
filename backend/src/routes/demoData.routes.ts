import { Router } from "express";
import { UserRole } from "@prisma/client";
import { generateDemoData, getStatus, seed, remove } from "../controllers/demoData.controller";
import { authenticate, authorize } from "../middleware/auth";

const router = Router();
const ADMIN = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN];

router.use(authenticate);

// Structural demo data (org/branch/classes/subjects/chart of
// accounts/etc) - SUPER_ADMIN only, since it creates/removes an entire
// Branch, not just records within one.
router.get("/status", authorize(UserRole.SUPER_ADMIN), getStatus);
router.post("/seed", authorize(UserRole.SUPER_ADMIN), seed);
router.post("/remove", authorize(UserRole.SUPER_ADMIN), remove);

// Bulk realistic transactional demo data for an EXISTING branch -
// Branch Admins may run this for their own branch too (same ADMIN set
// every other "create X" endpoint in this branch uses).
router.post("/generate", authorize(...ADMIN), generateDemoData);

export default router;
