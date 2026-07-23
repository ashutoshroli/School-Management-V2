import { Router } from "express";
import { UserRole } from "@prisma/client";
import { markStudentAttendance, studentCardTap, getClassAttendance, getStudentAttendanceHistory, getMyAssignedSections, getDayAttendanceSummary, verifyStudentAttendance } from "../controllers/studentAttendance.controller";
import { getPeriodConfigs, upsertPeriodConfigs } from "../controllers/periodConfig.controller";
import { getOrCreateTimetable, upsertSlot, getTeacherTimetable, deleteSlot, getTimetableConfig, updateTimetableConfig } from "../controllers/timetable.controller";
import { createExam, getExams, getExamById, updateExam, deleteExam, enterMarks, getExamResults, togglePublish, createPostponementRequest, acknowledgePostponementRequest, getPostponementRequests, upsertReportCardWeightage, getReportCardWeightages, getMyExamCreationScope } from "../controllers/exam.controller";
import { bulkSetExamSchedule, getExamSchedule, getExamScheduleList, updateExamScheduleEntry, deleteExamScheduleEntry, assignInvigilator, removeInvigilator, getInvigilators } from "../controllers/examSchedule.controller";
import { uploadExamQuestionPaper, getExamQuestionPapers, deleteExamQuestionPaper } from "../controllers/examQuestionPaper.controller";
import { generateSeatPlan, getSeatPlan, clearSeatPlan, getStudentSeatSlipPdf } from "../controllers/examSeatPlan.controller";
import { markExamAttendance, getExamAttendance, getExamAttendanceSummary } from "../controllers/examAttendance.controller";
import { generateAdmitCard, bulkGenerateAdmitCards, getAdmitCards, deleteAdmitCard, getAdmitCardPdf } from "../controllers/admitCard.controller";
import { getGradeBands, createGradeBand, updateGradeBand, deleteGradeBand } from "../controllers/gradeSystem.controller";
import { getReportCardPdf } from "../controllers/document.controller";
import { createHomework, getHomeworks, getHomeworkById, updateHomework, deleteHomework, submitHomework, getSubmissions, gradeHomeworkSubmission, raiseRecheckRequest, getRecheckRequests, resolveOrEscalateRecheckRequest, upsertRecheckEscalationConfig, getRecheckEscalationConfig } from "../controllers/homework.controller";
import { bulkPromote } from "../controllers/promotion.controller";
import { authenticate, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { uploadExamPaper, handleUploadErrors } from "../middleware/upload";
import { markStudentAttendanceSchema, cardTapSchema } from "../validators/attendance.validator";
import { getOrCreateTimetableSchema, upsertSlotSchema, updateTimetableConfigSchema } from "../validators/timetable.validator";
import { createExamSchema, updateExamSchema, enterMarksSchema, createPostponementRequestSchema, acknowledgePostponementRequestSchema, upsertReportCardWeightageSchema } from "../validators/exam.validator";
import { assignInvigilatorSchema } from "../validators/examSchedule.validator";
import { bulkSetExamScheduleSchema, updateExamScheduleEntrySchema } from "../validators/examSchedule.validator";
import { generateSeatPlanSchema } from "../validators/examSeatPlan.validator";
import { markExamAttendanceSchema } from "../validators/examAttendance.validator";
import { generateAdmitCardSchema, bulkGenerateAdmitCardsSchema } from "../validators/admitCard.validator";
import { createGradeBandSchema, updateGradeBandSchema } from "../validators/gradeSystem.validator";
import { createHomeworkSchema, updateHomeworkSchema, submitHomeworkSchema, gradeHomeworkSubmissionSchema, raiseRecheckRequestSchema, resolveOrEscalateRecheckRequestSchema, upsertRecheckEscalationConfigSchema } from "../validators/homework.validator";
import { bulkPromoteSchema } from "../validators/promotion.validator";

const router = Router();
const ADMIN = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN];
const TEACHERS = [...ADMIN, UserRole.TEACHER];
// Timetable creation rights (spec Section 20 - "Class Timetable
// creation rights: Principal"). ADMIN (Super/Branch Admin) can still
// create/edit anything per spec Section 3 ("Admin/Director: Create/
// Edit EVERYTHING") - PRINCIPAL/VICE_PRINCIPAL are ADDED here, not a
// replacement for ADMIN. Previously this array only ever contained
// ADMIN, so a Principal - the role the spec explicitly names as the
// one with these rights - could never create or edit a timetable at
// all.
const TIMETABLE_CREATORS = [...ADMIN, UserRole.PRINCIPAL, UserRole.VICE_PRINCIPAL];

// Student Attendance
router.post("/attendance/mark", authenticate, authorize(...TEACHERS), validate(markStudentAttendanceSchema), markStudentAttendance);
router.post("/attendance/card-tap", validate(cardTapSchema), studentCardTap); // Device auth via API key
router.get("/attendance/class", authenticate, authorize(...TEACHERS), getClassAttendance);
router.get("/attendance/my-sections", authenticate, authorize(UserRole.TEACHER), getMyAssignedSections);
// Class Teacher manual verification, alongside RFID auto-tracking (spec Section 6)
router.patch("/attendance/:id/verify", authenticate, authorize(...TEACHERS), verifyStudentAttendance);
router.get("/attendance/day-summary", authenticate, getDayAttendanceSummary);
// Access control (branch staff OR the student/parent themselves) is
// enforced inside the controller via canAccessBranch/canAccessStudentRecord.
router.get("/attendance/student/:studentId", authenticate, getStudentAttendanceHistory);

// Period Config (admin-configurable periods-per-day for a branch)
router.get("/period-config", authenticate, getPeriodConfigs);
router.put("/period-config", authenticate, authorize(...ADMIN), upsertPeriodConfigs);

// Timetable
router.post("/timetable", authenticate, authorize(...TIMETABLE_CREATORS), validate(getOrCreateTimetableSchema), getOrCreateTimetable);
router.post("/timetable/slot", authenticate, authorize(...TIMETABLE_CREATORS), validate(upsertSlotSchema), upsertSlot);
router.get("/timetable/teacher/:teacherId", authenticate, getTeacherTimetable);
router.delete("/timetable/slot/:id", authenticate, authorize(...TIMETABLE_CREATORS), deleteSlot);
router.get("/timetable/config/:branchId", authenticate, authorize(...TIMETABLE_CREATORS), getTimetableConfig);
router.put("/timetable/config/:branchId", authenticate, authorize(...TIMETABLE_CREATORS), validate(updateTimetableConfigSchema), updateTimetableConfig);

// Exam Timetable ("date sheet") - per-subject date/time/room/maxMarks.
// IMPORTANT: These MUST be defined BEFORE the /exams/:id routes to avoid route conflicts.
// In Express, more specific routes should come before parameterized routes.
router.put("/exams/schedule", authenticate, authorize(...ADMIN), validate(bulkSetExamScheduleSchema), bulkSetExamSchedule);
router.get("/exams/schedule", authenticate, getExamScheduleList); // Get all schedules for exams user has access to
router.get("/exams/:examId/schedule", authenticate, getExamSchedule);
router.put("/exams/schedule/:id", authenticate, authorize(...ADMIN), validate(updateExamScheduleEntrySchema), updateExamScheduleEntry);
router.delete("/exams/schedule/:id", authenticate, authorize(...ADMIN), deleteExamScheduleEntry);

// Invigilator duty assignment + clash check (spec Section 20)
router.post("/exams/invigilators", authenticate, authorize(...ADMIN, UserRole.PRINCIPAL, UserRole.VICE_PRINCIPAL), validate(assignInvigilatorSchema), assignInvigilator);
router.get("/exams/schedule/:examScheduleId/invigilators", authenticate, getInvigilators);
router.delete("/exams/schedule/:examScheduleId/invigilators/:staffId", authenticate, authorize(...ADMIN, UserRole.PRINCIPAL, UserRole.VICE_PRINCIPAL), removeInvigilator);

// Exam postponement request flow (spec Section 9)
router.post("/exams/postponement", authenticate, authorize(...ADMIN, UserRole.PRINCIPAL, UserRole.VICE_PRINCIPAL), validate(createPostponementRequestSchema), createPostponementRequest);
router.get("/exams/postponement", authenticate, authorize(...TEACHERS, UserRole.PRINCIPAL, UserRole.VICE_PRINCIPAL), getPostponementRequests);
router.patch("/exams/postponement/:id/acknowledge", authenticate, authorize(...TEACHERS, UserRole.PRINCIPAL, UserRole.VICE_PRINCIPAL), validate(acknowledgePostponementRequestSchema), acknowledgePostponementRequest);

// Report card weightage per exam type (spec Section 9 - set by Principal)
router.put("/exams/report-card-weightage", authenticate, authorize(...ADMIN, UserRole.PRINCIPAL, UserRole.VICE_PRINCIPAL), validate(upsertReportCardWeightageSchema), upsertReportCardWeightage);
router.get("/exams/report-card-weightage/:branchId", authenticate, getReportCardWeightages);

// Exam Question Papers (PDF/DOCX, teacher-scoped to their own subject/class)
// IMPORTANT: "/exams/question-papers" MUST be defined BEFORE "/exams/:id"
// below. Both share the same path shape ("/exams/<one segment>"), and
// Express matches routes in REGISTRATION ORDER, not "literal beats
// param" - if "/exams/:id" were registered first, every request to
// GET /exams/question-papers would be silently intercepted by
// getExamById with id="question-papers" (always 404s, never calls
// next()), making getExamQuestionPapers permanently unreachable and
// bypassing its authorize(...TEACHERS) check. Same ordering convention
// already used above for "/exams/schedule" vs "/exams/:id".
router.post("/exams/question-papers", authenticate, authorize(...TEACHERS), handleUploadErrors(uploadExamPaper), uploadExamQuestionPaper);
router.get("/exams/question-papers", authenticate, authorize(...TEACHERS), getExamQuestionPapers);
router.delete("/exams/question-papers/:id", authenticate, authorize(...TEACHERS), deleteExamQuestionPaper);

// A TEACHER's own exam-creation scope (spec Section 9) - MUST be
// defined before "/exams/:id" below, same route-ordering reason as
// "/exams/schedule" and "/exams/question-papers" above (otherwise
// getExamById would intercept this path with id="my-creation-scope").
router.get("/exams/my-creation-scope", authenticate, authorize(UserRole.TEACHER), getMyExamCreationScope);

// Exams - CRUD operations (defined AFTER exam schedule + question-paper
// routes to avoid route conflicts - see comments above)
//
// BUG FIX (spec Section 9): createExam only ever allowed ADMIN
// (Super/Branch Admin) at the route level - but the controller itself
// already contains real, working scoping logic for a TEACHER
// creating a custom exam as either a Class Teacher (via sectionId) or
// a Subject Teacher (via subjectId), gated by
// section.classTeacherId/SubjectTeacher checks. That logic could
// never run at all: any TEACHER request was rejected by this route's
// authorize() BEFORE the controller ever saw it. Also adding
// PRINCIPAL/VICE_PRINCIPAL - spec Section 9 names Principal as the
// role with "any scope" creation rights, but they were previously
// excluded from creating exams entirely (same class of bug as the
// Timetable fix above).
router.post("/exams", authenticate, authorize(...ADMIN, UserRole.PRINCIPAL, UserRole.VICE_PRINCIPAL, UserRole.TEACHER), validate(createExamSchema), createExam);
router.get("/exams", authenticate, getExams);
router.get("/exams/:id", authenticate, getExamById);
router.put("/exams/:id", authenticate, authorize(...ADMIN, UserRole.PRINCIPAL, UserRole.VICE_PRINCIPAL), validate(updateExamSchema), updateExam);
router.delete("/exams/:id", authenticate, authorize(...ADMIN, UserRole.PRINCIPAL, UserRole.VICE_PRINCIPAL), deleteExam);
router.post("/exams/marks", authenticate, authorize(...TEACHERS), validate(enterMarksSchema), enterMarks);
router.get("/exams/:examId/results", authenticate, getExamResults);
router.get("/exams/:examId/report-card/:studentId", authenticate, getReportCardPdf);
router.patch("/exams/:id/publish", authenticate, authorize(...ADMIN), togglePublish);

// Exam Seat Plan (room-wise seating for one exam subject sitting)
router.post("/exams/schedule/:examScheduleId/seat-plan", authenticate, authorize(...ADMIN), validate(generateSeatPlanSchema), generateSeatPlan);
router.get("/exams/schedule/:examScheduleId/seat-plan", authenticate, getSeatPlan);
router.delete("/exams/schedule/:examScheduleId/seat-plan", authenticate, authorize(...ADMIN), clearSeatPlan);
router.get("/exams/schedule/:examScheduleId/seat-plan/student/:studentId/slip", authenticate, getStudentSeatSlipPdf);

// Exam Attendance (per-sitting, separate from daily StudentAttendance)
router.post("/exams/schedule/:examScheduleId/attendance", authenticate, authorize(...TEACHERS), validate(markExamAttendanceSchema), markExamAttendance);
router.get("/exams/schedule/:examScheduleId/attendance", authenticate, authorize(...TEACHERS), getExamAttendance);
router.get("/exams/:examId/attendance-summary", authenticate, authorize(...TEACHERS), getExamAttendanceSummary);

// Admit Cards (single + bulk generation, eligibility rules, template-first PDF)
router.post("/exams/:examId/admit-cards/generate", authenticate, authorize(...ADMIN), validate(generateAdmitCardSchema), generateAdmitCard);
router.post("/exams/:examId/admit-cards/bulk-generate", authenticate, authorize(...ADMIN), validate(bulkGenerateAdmitCardsSchema), bulkGenerateAdmitCards);
router.get("/exams/:examId/admit-cards", authenticate, authorize(...TEACHERS), getAdmitCards);
router.delete("/exams/:examId/admit-cards/:studentId", authenticate, authorize(...ADMIN), deleteAdmitCard);
router.get("/exams/:examId/admit-cards/:studentId/pdf", authenticate, getAdmitCardPdf);

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
router.patch("/homework/submissions/:id/grade", authenticate, authorize(...TEACHERS), validate(gradeHomeworkSubmissionSchema), gradeHomeworkSubmission);

// Homework recheck-request escalation flow (spec Section 10)
router.post("/homework/recheck", authenticate, authorize(UserRole.STUDENT, UserRole.PARENT), validate(raiseRecheckRequestSchema), raiseRecheckRequest);
router.get("/homework/recheck", authenticate, authorize(...TEACHERS, UserRole.PRINCIPAL, UserRole.VICE_PRINCIPAL), getRecheckRequests);
router.patch("/homework/recheck/:id", authenticate, authorize(...TEACHERS, UserRole.PRINCIPAL, UserRole.VICE_PRINCIPAL), validate(resolveOrEscalateRecheckRequestSchema), resolveOrEscalateRecheckRequest);
router.get("/homework/recheck/config", authenticate, authorize(UserRole.SUPER_ADMIN), getRecheckEscalationConfig);
router.put("/homework/recheck/config", authenticate, authorize(UserRole.SUPER_ADMIN), validate(upsertRecheckEscalationConfigSchema), upsertRecheckEscalationConfig);

// Promotion
router.post("/promote", authenticate, authorize(...ADMIN), validate(bulkPromoteSchema), bulkPromote);

export default router;
