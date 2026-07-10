import { Router } from "express";
import { UserRole } from "@prisma/client";
import {
  createAcademicYear,
  getAcademicYears,
  setActiveYear,
  updateAcademicYear,
} from "../controllers/academicYear.controller";
import { authenticate, authorize } from "../middleware/auth";

const router = Router();

router.use(authenticate);

router.post("/", authorize(UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN), createAcademicYear);
router.get("/", getAcademicYears);
router.put("/:id", authorize(UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN), updateAcademicYear);
router.patch("/:id/activate", authorize(UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN), setActiveYear);

export default router;
