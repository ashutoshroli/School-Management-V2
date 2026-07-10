import { Router } from "express";
import { UserRole } from "@prisma/client";
import { getDashboardStats, getMultiBranchSummary, getAttendanceAnalytics, getAcademicAnalytics, getHRAnalytics } from "../controllers/reports.controller";
import { authenticate, authorize } from "../middleware/auth";

const router = Router();
const ADMIN = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN];

router.use(authenticate);

router.get("/dashboard", authorize(...ADMIN), getDashboardStats);
router.get("/multi-branch", authorize(UserRole.SUPER_ADMIN), getMultiBranchSummary);
router.get("/attendance-analytics", authorize(...ADMIN), getAttendanceAnalytics);
router.get("/academic-analytics", authorize(...ADMIN), getAcademicAnalytics);
router.get("/hr-analytics", authorize(...ADMIN), getHRAnalytics);

export default router;
