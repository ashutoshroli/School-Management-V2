import { Router } from "express";
import { UserRole } from "@prisma/client";
import {
  createBranch, getBranches, getBranchById, updateBranch,
  createBranchAdmin, getBranchAdmins, setBranchAdminStatus,
} from "../controllers/branch.controller";
import { authenticate, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  createBranchSchema, updateBranchSchema,
  createBranchAdminSchema, setBranchAdminStatusSchema,
} from "../validators/branch.validator";

const router = Router();

// All branch routes require authentication
router.use(authenticate);

router.post("/", authorize(UserRole.SUPER_ADMIN), validate(createBranchSchema), createBranch);
router.get("/", authorize(UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN), getBranches);

// Branch Admin management - must be registered before "/:id" so
// "admins" isn't swallowed as a branch id param.
router.get("/admins", authorize(UserRole.SUPER_ADMIN), getBranchAdmins);
router.post("/admins", authorize(UserRole.SUPER_ADMIN), validate(createBranchAdminSchema), createBranchAdmin);
router.patch("/admins/:staffId/status", authorize(UserRole.SUPER_ADMIN), validate(setBranchAdminStatusSchema), setBranchAdminStatus);

router.get("/:id", authorize(UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN), getBranchById);
router.put("/:id", authorize(UserRole.SUPER_ADMIN), validate(updateBranchSchema), updateBranch);

export default router;
