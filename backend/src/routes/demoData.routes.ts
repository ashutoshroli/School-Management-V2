import { Router } from "express";
import { UserRole } from "@prisma/client";
import { generateDemoData } from "../controllers/demoData.controller";
import { authenticate, authorize } from "../middleware/auth";

const router = Router();
const ADMIN = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN];

router.use(authenticate);

router.post("/generate", authorize(...ADMIN), generateDemoData);

export default router;
