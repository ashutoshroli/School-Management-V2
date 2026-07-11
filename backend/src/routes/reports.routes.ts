import { Router } from "express";
import { UserRole } from "@prisma/client";
import { getDashboardStats, getMultiBranchSummary, getAttendanceAnalytics, getAttendanceDefaultersList, exportAttendanceDefaultersCsv, getAcademicAnalytics, getHRAnalytics, getAuditLog } from "../controllers/reports.controller";
import { authenticate, authorize } from "../middleware/auth";

const router = Router();
const ADMIN = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN];
const ADMIN_AND_TEACHER = [...ADMIN, UserRole.TEACHER];

router.use(authenticate);

router.get("/dashboard", authorize(...ADMIN), getDashboardStats);
router.get("/multi-branch", authorize(UserRole.SUPER_ADMIN), getMultiBranchSummary);
router.get("/attendance-analytics", authorize(...ADMIN), getAttendanceAnalytics);
// Teachers can also pull this (to follow up with their own class's
// at-risk students) - unlike the other /reports endpoints, which are
// branch-wide financial/audit views restricted to admins only.
router.get("/attendance-defaulters", authorize(...ADMIN_AND_TEACHER), getAttendanceDefaultersList);
router.get("/attendance-defaulters/export", authorize(...ADMIN_AND_TEACHER), exportAttendanceDefaultersCsv);
router.get("/academic-analytics", authorize(...ADMIN), getAcademicAnalytics);
router.get("/hr-analytics", authorize(...ADMIN), getHRAnalytics);
router.get("/audit-log", authorize(...ADMIN), getAuditLog);

export default router;
