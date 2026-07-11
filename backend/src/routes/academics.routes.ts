import { Router } from "express";
import { UserRole } from "@prisma/client";
import { markStudentAttendance, studentCardTap, getClassAttendance, getStudentAttendanceHistory } from "../controllers/studentAttendance.controller";
import { getOrCreateTimetable, upsertSlot, getTeacherTimetable, deleteSlot } from "../controllers/timetable.controller";
import { createExam, getExams, updateExam, deleteExam, enterMarks, getExamResults, togglePublish } from "../controllers/exam.controller";
import { getReportCardPdf } from "../controllers/document.controller";
import { createHomework, getHomeworks, updateHomework, deleteHomework, submitHomework, getSubmissions } from "../controllers/homework.controller";
import { bulkPromote } from "../controllers/promotion.controller";
import { authenticate, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { markStudentAttendanceSchema, cardTapSchema } from "../validators/attendance.validator";
import { getOrCreateTimetableSchema, upsertSlotSchema } from "../validators/timetable.validator";
import { createExamSchema, updateExamSchema, enterMarksSchema } from "../validators/exam.validator";
import { createHomeworkSchema, updateHomeworkSchema, submitHomeworkSchema } from "../validators/homework.validator";
import { bulkPromoteSchema } from "../validators/promotion.validator";

const router = Router();
const ADMIN = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN];
const TEACHERS = [...ADMIN, UserRole.TEACHER];

// Student Attendance
router.post("/attendance/mark", authenticate, authorize(...TEACHERS), validate(markStudentAttendanceSchema), markStudentAttendance);
router.post("/attendance/card-tap", validate(cardTapSchema), studentCardTap); // Device auth via API key
router.get("/attendance/class", authenticate, authorize(...TEACHERS), getClassAttendance);
// Access control (branch staff OR the student/parent themselves) is
// enforced inside the controller via canAccessBranch/canAccessStudentRecord.
router.get("/attendance/student/:studentId", authenticate, getStudentAttendanceHistory);

// Timetable
router.post("/timetable", authenticate, authorize(...ADMIN), validate(getOrCreateTimetableSchema), getOrCreateTimetable);
router.post("/timetable/slot", authenticate, authorize(...ADMIN), validate(upsertSlotSchema), upsertSlot);
router.get("/timetable/teacher/:teacherId", authenticate, getTeacherTimetable);
router.delete("/timetable/slot/:id", authenticate, authorize(...ADMIN), deleteSlot);

// Exams
router.post("/exams", authenticate, authorize(...ADMIN), validate(createExamSchema), createExam);
router.get("/exams", authenticate, getExams);
router.put("/exams/:id", authenticate, authorize(...ADMIN), validate(updateExamSchema), updateExam);
router.delete("/exams/:id", authenticate, authorize(...ADMIN), deleteExam);
router.post("/exams/marks", authenticate, authorize(...TEACHERS), validate(enterMarksSchema), enterMarks);
router.get("/exams/:examId/results", authenticate, getExamResults);
router.get("/exams/:examId/report-card/:studentId", authenticate, getReportCardPdf);
router.patch("/exams/:id/publish", authenticate, authorize(...ADMIN), togglePublish);

// Homework
router.post("/homework", authenticate, authorize(...TEACHERS), validate(createHomeworkSchema), createHomework);
router.get("/homework", authenticate, getHomeworks);
router.put("/homework/:id", authenticate, authorize(...TEACHERS), validate(updateHomeworkSchema), updateHomework);
router.delete("/homework/:id", authenticate, authorize(...TEACHERS), deleteHomework);
router.post("/homework/submit", authenticate, authorize(UserRole.STUDENT), validate(submitHomeworkSchema), submitHomework);
router.get("/homework/:homeworkId/submissions", authenticate, authorize(...TEACHERS), getSubmissions);

// Promotion
router.post("/promote", authenticate, authorize(...ADMIN), validate(bulkPromoteSchema), bulkPromote);

export default router;
