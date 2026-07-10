import { Router } from "express";
import { UserRole } from "@prisma/client";
import { createStaff, getStaffList, getStaffById, updateStaff } from "../controllers/staff.controller";
import { authenticate, authorize } from "../middleware/auth";

const router = Router();
const ADMIN = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN];

router.use(authenticate);

router.post("/", authorize(...ADMIN), createStaff);
router.get("/", authorize(...ADMIN), getStaffList);
router.get("/:id", authenticate, getStaffById);
router.put("/:id", authorize(...ADMIN), updateStaff);

export default router;
