import { Router } from "express";
import { UserRole } from "@prisma/client";
import { createBranch, getBranches, getBranchById, updateBranch } from "../controllers/branch.controller";
import { authenticate, authorize } from "../middleware/auth";

const router = Router();

// All branch routes require authentication
router.use(authenticate);

router.post("/", authorize(UserRole.SUPER_ADMIN), createBranch);
router.get("/", authorize(UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN), getBranches);
router.get("/:id", authorize(UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN), getBranchById);
router.put("/:id", authorize(UserRole.SUPER_ADMIN), updateBranch);

export default router;
