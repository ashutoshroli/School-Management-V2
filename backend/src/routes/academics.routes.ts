import { Router } from "express";
import { UserRole } from "@prisma/client";
import { markStudentAttendance, studentCardTap, getClassAttendance, getStudentAttendanceHistory, getMyAssignedSections, getDayAttendanceSummary } from "../controllers/studentAttendance.controller";
import { getPeriodConfigs, upsertPeriodConfigs } from "../controllers/periodConfig.controller";
import { getOrCreateTimetable, upsertSlot, getTeacherTimetable, deleteSlot } from "../controllers/timetable.controller";
import { createExam, getExams, getExamById, updateExam, deleteExam, enterMarks, getExamResults, togglePublish } from "../controllers/exam.controller";
import { bulkSetExamSchedule, getExamSchedule, updateExamScheduleEntry, deleteExamScheduleEntry } from "../controllers/examSchedule.controller";
import { uploadExamQuestionPaper, getExamQuestionPapers, deleteExamQuestionPaper } from "../controllers/examQuestionPaper.controller";
import { generateSeatPlan, getSeatPlan, clearSeatPlan, getStudentSeatSlipPdf } from "../controllers/examSeatPlan.controller";
import { markExamAttendance, getExamAttendance, getExamAttendanceSummary } from "../controllers/examAttendance.controller";
import { getGradeBands, createGradeBand, updateGradeBand, deleteGradeBand } from "../controllers/gradeSystem.controller";
import { getReportCardPdf } from "../controllers/document.controller";
import { createHomework, getHomeworks, getHomeworkById, updateHomework, deleteHomework, submitHomework, getSubmissions } from "../controllers/homework.controller";
import { bulkPromote } from "../controllers/promotion.controller";
import { authenticate, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { uploadExamPaper, handleUploadErrors } from "../middleware/upload";
import { markStudentAttendanceSchema, cardTapSchema } from "../validators/attendance.validator";
import { getOrCreateTimetableSchema, upsertSlotSchema } from "../validators/timetable.validator";
import { createExamSchema, updateExamSchema, enterMarksSchema } from "../validators/exam.validator";
import { bulkSetExamScheduleSchema, updateExamScheduleEntrySchema } from "../validators/examSchedule.validator";
import { generateSeatPlanSchema } from "../validators/examSeatPlan.validator";
import { markExamAttendanceSchema } from "../validators/examAttendance.validator";
import { createGradeBandSchema, updateGradeBandSchema } from "../validators/gradeSystem.validator";
import { createHomeworkSchema, updateHomeworkSchema, submitHomeworkSchema } from "../validators/homework.validator";
import { bulkPromoteSchema } from "../validators/promotion.validator";

const router = Router();
const ADMIN = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN];
const TEACHERS = [...ADMIN, UserRole.TEACHER];

// Student Attendance
router.post("/attendance/mark", authenticate, authorize(...TEACHERS), validate(markStudentAttendanceSchema), markStudentAttendance);
router.post("/attendance/card-tap", validate(cardTapSchema), studentCardTap); // Device auth via API key
router.get("/attendance/class", authenticate, authorize(...TEACHERS), getClassAttendance);
router.get("/attendance/my-sections", authenticate, authorize(UserRole.TEACHER), getMyAssignedSections);
router.get("/attendance/day-summary", authenticate, getDayAttendanceSummary);
// Access control (branch staff OR the student/parent themselves) is
// enforced inside the controller via canAccessBranch/canAccessStudentRecord.
router.get("/attendance/student/:studentId", authenticate, getStudentAttendanceHistory);

// Period Config (admin-configurable periods-per-day for a branch)
router.get("/period-config", authenticate, getPeriodConfigs);
router.put("/period-config", authenticate, authorize(...ADMIN), upsertPeriodConfigs);

// Timetable
router.post("/timetable", authenticate, authorize(...ADMIN), validate(getOrCreateTimetableSchema), getOrCreateTimetable);
router.post("/timetable/slot", authenticate, authorize(...ADMIN), validate(upsertSlotSchema), upsertSlot);
router.get("/timetable/teacher/:teacherId", authenticate, getTeacherTimetable);
router.delete("/timetable/slot/:id", authenticate, authorize(...ADMIN), deleteSlot);

// Exams
router.post("/exams", authenticate, authorize(...ADMIN), validate(createExamSchema), createExam);
router.get("/exams", authenticate, getExams);
router.get("/exams/:id", authenticate, getExamById);
router.put("/exams/:id", authenticate, authorize(...ADMIN), validate(updateExamSchema), updateExam);
router.delete("/exams/:id", authenticate, authorize(...ADMIN), deleteExam);
router.post("/exams/marks", authenticate, authorize(...TEACHERS), validate(enterMarksSchema), enterMarks);
router.get("/exams/:examId/results", authenticate, getExamResults);
router.get("/exams/:examId/report-card/:studentId", authenticate, getReportCardPdf);
router.patch("/exams/:id/publish", authenticate, authorize(...ADMIN), togglePublish);

// Exam Timetable ("date sheet") - per-subject date/time/room/maxMarks.
router.put("/exams/schedule", authenticate, authorize(...ADMIN), validate(bulkSetExamScheduleSchema), bulkSetExamSchedule);
router.get("/exams/:examId/schedule", authenticate, getExamSchedule);
router.put("/exams/schedule/:id", authenticate, authorize(...ADMIN), validate(updateExamScheduleEntrySchema), updateExamScheduleEntry);
router.delete("/exams/schedule/:id", authenticate, authorize(...ADMIN), deleteExamScheduleEntry);

// Exam Question Papers (PDF/DOCX, teacher-scoped to their own subject/class)
router.post("/exams/question-papers", authenticate, authorize(...TEACHERS), handleUploadErrors(uploadExamPaper), uploadExamQuestionPaper);
router.get("/exams/question-papers", authenticate, authorize(...TEACHERS), getExamQuestionPapers);
router.delete("/exams/question-papers/:id", authenticate, authorize(...TEACHERS), deleteExamQuestionPaper);

// Exam Seat Plan (room-wise seating for one exam subject sitting)
router.post("/exams/schedule/:examScheduleId/seat-plan", authenticate, authorize(...ADMIN), validate(generateSeatPlanSchema), generateSeatPlan);
router.get("/exams/schedule/:examScheduleId/seat-plan", authenticate, getSeatPlan);
router.delete("/exams/schedule/:examScheduleId/seat-plan", authenticate, authorize(...ADMIN), clearSeatPlan);
router.get("/exams/schedule/:examScheduleId/seat-plan/student/:studentId/slip", authenticate, getStudentSeatSlipPdf);

// Exam Attendance (per-sitting, separate from daily StudentAttendance)
router.post("/exams/schedule/:examScheduleId/attendance", authenticate, authorize(...TEACHERS), validate(markExamAttendanceSchema), markExamAttendance);
router.get("/exams/schedule/:examScheduleId/attendance", authenticate, authorize(...TEACHERS), getExamAttendance);
router.get("/exams/:examId/attendance-summary", authenticate, authorize(...TEACHERS), getExamAttendanceSummary);

// Grade System (grading scale bands, e.g. CBSE A1/A2/B1...) - system-wide,
// not branch-scoped (see gradeSystem.controller.ts's doc comment), so any
// authenticated user can read the bands (needed to show a grade on a
// report card/results view) but only ADMIN can manage them.
router.get("/grade-system", authenticate, getGradeBands);
router.post("/grade-system", authenticate, authorize(...ADMIN), validate(createGradeBandSchema), createGradeBand);
router.put("/grade-system/:id", authenticate, authorize(...ADMIN), validate(updateGradeBandSchema), updateGradeBand);
router.delete("/grade-system/:id", authenticate, authorize(...ADMIN), deleteGradeBand);

// Homework
router.post("/homework", authenticate, authorize(...TEACHERS), validate(createHomeworkSchema), createHomework);
router.get("/homework", authenticate, getHomeworks);
router.get("/homework/:id", authenticate, getHomeworkById);
router.put("/homework/:id", authenticate, authorize(...TEACHERS), validate(updateHomeworkSchema), updateHomework);
router.delete("/homework/:id", authenticate, authorize(...TEACHERS), deleteHomework);
router.post("/homework/submit", authenticate, authorize(UserRole.STUDENT), validate(submitHomeworkSchema), submitHomework);
router.get("/homework/:homeworkId/submissions", authenticate, authorize(...TEACHERS), getSubmissions);

// Promotion
router.post("/promote", authenticate, authorize(...ADMIN), validate(bulkPromoteSchema), bulkPromote);

export default router;
