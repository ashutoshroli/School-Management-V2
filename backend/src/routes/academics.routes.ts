import { Router } from "express";
import { UserRole } from "@prisma/client";
import { markStudentAttendance, studentCardTap, getClassAttendance, getStudentAttendanceHistory } from "../controllers/studentAttendance.controller";
import { getOrCreateTimetable, upsertSlot, getTeacherTimetable, deleteSlot } from "../controllers/timetable.controller";
import { createExam, getExams, enterMarks, getExamResults, togglePublish } from "../controllers/exam.controller";
import { getReportCardPdf } from "../controllers/document.controller";
import { createHomework, getHomeworks, submitHomework, getSubmissions } from "../controllers/homework.controller";
import { bulkPromote } from "../controllers/promotion.controller";
import { authenticate, authorize } from "../middleware/auth";

const router = Router();
const ADMIN = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN];
const TEACHERS = [...ADMIN, UserRole.TEACHER];

// Student Attendance
router.post("/attendance/mark", authenticate, authorize(...TEACHERS), markStudentAttendance);
router.post("/attendance/card-tap", studentCardTap); // Device auth via API key
router.get("/attendance/class", authenticate, authorize(...TEACHERS), getClassAttendance);
// Access control (branch staff OR the student/parent themselves) is
// enforced inside the controller via canAccessBranch/canAccessStudentRecord.
router.get("/attendance/student/:studentId", authenticate, getStudentAttendanceHistory);

// Timetable
router.post("/timetable", authenticate, authorize(...ADMIN), getOrCreateTimetable);
router.post("/timetable/slot", authenticate, authorize(...ADMIN), upsertSlot);
router.get("/timetable/teacher/:teacherId", authenticate, getTeacherTimetable);
router.delete("/timetable/slot/:id", authenticate, authorize(...ADMIN), deleteSlot);

// Exams
router.post("/exams", authenticate, authorize(...ADMIN), createExam);
router.get("/exams", authenticate, getExams);
router.post("/exams/marks", authenticate, authorize(...TEACHERS), enterMarks);
router.get("/exams/:examId/results", authenticate, getExamResults);
router.get("/exams/:examId/report-card/:studentId", authenticate, getReportCardPdf);
router.patch("/exams/:id/publish", authenticate, authorize(...ADMIN), togglePublish);

// Homework
router.post("/homework", authenticate, authorize(...TEACHERS), createHomework);
router.get("/homework", authenticate, getHomeworks);
router.post("/homework/submit", authenticate, authorize(UserRole.STUDENT), submitHomework);
router.get("/homework/:homeworkId/submissions", authenticate, authorize(...TEACHERS), getSubmissions);

// Promotion
router.post("/promote", authenticate, authorize(...ADMIN), bulkPromote);

export default router;
