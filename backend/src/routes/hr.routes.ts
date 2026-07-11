import { Router } from "express";
import { UserRole } from "@prisma/client";
import { markAttendance, bulkMarkAttendance, cardTapAttendance, getAttendanceCalendar, getDateAttendance } from "../controllers/staffAttendance.controller";
import { getLeaveTypes, applyLeave, getLeaveApplications, updateLeaveStatus, getLeaveBalance } from "../controllers/leave.controller";
import { upsertSalaryStructure, getSalaryStructure, runPayroll, getPayslips, approvePayslip, markPaid, getStaffPayslip, getPayslipPdf } from "../controllers/payroll.controller";
import { authenticate, authorize } from "../middleware/auth";

const router = Router();
const ADMIN = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN];
const STAFF_ROLES = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN, UserRole.TEACHER, UserRole.ACCOUNTANT, UserRole.LIBRARIAN, UserRole.TRANSPORT_MANAGER, UserRole.WARDEN, UserRole.STAFF];

// ===== STAFF ATTENDANCE =====
router.post("/attendance/mark", authenticate, authorize(...ADMIN), markAttendance);
router.post("/attendance/bulk", authenticate, authorize(...ADMIN), bulkMarkAttendance);
router.post("/attendance/card-tap", cardTapAttendance); // No auth - device uses API key in body
router.get("/attendance/calendar/:staffId", authenticate, getAttendanceCalendar);
router.get("/attendance/date", authenticate, authorize(...ADMIN), getDateAttendance);

// ===== LEAVE MANAGEMENT =====
router.get("/leave/types", authenticate, getLeaveTypes);
router.post("/leave/apply", authenticate, authorize(...STAFF_ROLES), applyLeave);
router.get("/leave/applications", authenticate, getLeaveApplications);
router.patch("/leave/:id/status", authenticate, authorize(...ADMIN), updateLeaveStatus);
router.get("/leave/balance/:staffId", authenticate, getLeaveBalance);

// ===== PAYROLL =====
router.post("/salary-structure", authenticate, authorize(...ADMIN), upsertSalaryStructure);
router.get("/salary-structure/:staffId", authenticate, getSalaryStructure);
router.post("/payroll/run", authenticate, authorize(...ADMIN), runPayroll);
router.get("/payroll/payslips", authenticate, authorize(...ADMIN), getPayslips);
router.patch("/payroll/payslip/:id/approve", authenticate, authorize(...ADMIN), approvePayslip);
router.patch("/payroll/payslip/:id/paid", authenticate, authorize(...ADMIN), markPaid);
router.get("/payroll/payslip/:staffId/:month/:year", authenticate, getStaffPayslip);
router.get("/payroll/payslip/:staffId/:month/:year/pdf", authenticate, getPayslipPdf);

export default router;
