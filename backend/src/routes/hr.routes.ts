import { Router } from "express";
import { UserRole } from "@prisma/client";
import { markAttendance, bulkMarkAttendance, cardTapAttendance, getAttendanceCalendar, getDateAttendance, selfMarkAttendance, getStaffAttendanceReport, exportStaffAttendanceReportCsv } from "../controllers/staffAttendance.controller";
import { getLeaveTypes, getLeaveTypeById, applyLeave, getLeaveApplications, updateLeaveStatus, bulkUpdateLeaveStatus, getLeaveBalance, createLeaveType, updateLeaveType, deleteLeaveType } from "../controllers/leave.controller";
import { upsertSalaryStructure, bulkAssignSalaryStructure, assignSalaryStructureToStaff, getSalaryStructure, runPayroll, getPayslips, approvePayslip, markPaid, getStaffPayslip, getPayslipPdf } from "../controllers/payroll.controller";
import { getHolidays, createHoliday, deleteHoliday } from "../controllers/holiday.controller";
import { authenticate, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { markStaffAttendanceSchema, bulkMarkStaffAttendanceSchema, cardTapSchema } from "../validators/attendance.validator";
import { applyLeaveSchema, updateLeaveStatusSchema, bulkUpdateLeaveStatusSchema, createLeaveTypeSchema, updateLeaveTypeSchema } from "../validators/leave.validator";
import { upsertSalaryStructureSchema, bulkAssignSalaryStructureSchema, assignSalaryStructureToStaffSchema, runPayrollSchema } from "../validators/payroll.validator";
import { createHolidaySchema } from "../validators/holiday.validator";

const router = Router();
const ADMIN = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN];
const STAFF_ROLES = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN, UserRole.TEACHER, UserRole.ACCOUNTANT, UserRole.LIBRARIAN, UserRole.TRANSPORT_MANAGER, UserRole.WARDEN, UserRole.STAFF];

// ===== STAFF ATTENDANCE =====
router.post("/attendance/mark", authenticate, authorize(...ADMIN), validate(markStaffAttendanceSchema), markAttendance);
router.post("/attendance/bulk", authenticate, authorize(...ADMIN), validate(bulkMarkStaffAttendanceSchema), bulkMarkAttendance);
router.post("/attendance/card-tap", validate(cardTapSchema), cardTapAttendance); // No auth - device uses API key in body
router.get("/attendance/calendar/:staffId", authenticate, getAttendanceCalendar);
router.get("/attendance/date", authenticate, authorize(...ADMIN), getDateAttendance);
router.post("/attendance/self", authenticate, authorize(...STAFF_ROLES), selfMarkAttendance);
router.get("/attendance/report", authenticate, authorize(...ADMIN), getStaffAttendanceReport);
router.get("/attendance/report/csv", authenticate, authorize(...ADMIN), exportStaffAttendanceReportCsv);

// ===== HOLIDAYS =====
router.get("/holidays", authenticate, getHolidays);
router.post("/holidays", authenticate, authorize(...ADMIN), validate(createHolidaySchema), createHoliday);
router.delete("/holidays/:id", authenticate, authorize(...ADMIN), deleteHoliday);

// ===== LEAVE MANAGEMENT =====
router.get("/leave/types", authenticate, getLeaveTypes);
router.get("/leave/types/:id", authenticate, getLeaveTypeById);
router.post("/leave/types", authenticate, authorize(...ADMIN), validate(createLeaveTypeSchema), createLeaveType);
router.put("/leave/types/:id", authenticate, authorize(...ADMIN), validate(updateLeaveTypeSchema), updateLeaveType);
router.delete("/leave/types/:id", authenticate, authorize(...ADMIN), deleteLeaveType);
router.post("/leave/apply", authenticate, authorize(...STAFF_ROLES), validate(applyLeaveSchema), applyLeave);
router.get("/leave/applications", authenticate, getLeaveApplications);
router.patch("/leave/:id/status", authenticate, authorize(...ADMIN), validate(updateLeaveStatusSchema), updateLeaveStatus);
router.patch("/leave/status/bulk", authenticate, authorize(...ADMIN), validate(bulkUpdateLeaveStatusSchema), bulkUpdateLeaveStatus);
router.get("/leave/balance/:staffId", authenticate, getLeaveBalance);

// ===== PAYROLL =====
router.post("/salary-structure", authenticate, authorize(...ADMIN), validate(upsertSalaryStructureSchema), upsertSalaryStructure);
router.post("/salary-structure/bulk", authenticate, authorize(...ADMIN), validate(bulkAssignSalaryStructureSchema), bulkAssignSalaryStructure);
router.post("/salary-structure/staff", authenticate, authorize(...ADMIN), validate(assignSalaryStructureToStaffSchema), assignSalaryStructureToStaff);
router.get("/salary-structure/:staffId", authenticate, getSalaryStructure);
router.post("/payroll/run", authenticate, authorize(...ADMIN), validate(runPayrollSchema), runPayroll);
router.get("/payroll/payslips", authenticate, authorize(...ADMIN), getPayslips);
router.patch("/payroll/payslip/:id/approve", authenticate, authorize(...ADMIN), approvePayslip);
router.patch("/payroll/payslip/:id/paid", authenticate, authorize(...ADMIN), markPaid);
router.get("/payroll/payslip/:staffId/:month/:year", authenticate, getStaffPayslip);
router.get("/payroll/payslip/:staffId/:month/:year/pdf", authenticate, getPayslipPdf);

export default router;
