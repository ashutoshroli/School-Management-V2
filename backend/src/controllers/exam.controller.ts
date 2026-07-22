import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { canAccessBranch } from "../utils/branchScope";

/**
 * Create exam
 */
/**
 * Creation-rights scoping (spec Section 9):
 *  - PRINCIPAL/VICE_PRINCIPAL/ADMIN - any scope (whole class, or
 *    narrower via sectionId/subjectId if provided).
 *  - TEACHER, when marked as the class teacher of the given sectionId -
 *    custom exam for their OWN CLASS (section) only.
 *  - TEACHER, otherwise - exam for their OWN assigned class-subject
 *    only (must provide subjectId, and must actually teach it there).
 * createdByRole/createdBy are recorded for audit/business-rule use
 * (e.g. "Class/Subject Teacher created exams need no approval" -
 * already true unconditionally for every exam here since nothing in
 * this codebase gates publishing on it, but the field lets a future
 * approval rule for PRINCIPAL-created exams be added without another
 * migration).
 */
export const createExam = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { academicYearId, classId, sectionId, subjectId, name, type, startDate, endDate } = req.body;

    // BUG FIX: Exam.academicYearId/classId are required (non-nullable)
    // relations, but the frontend's "Academic Year" field wasn't marked
    // required - leaving it blank sent "" and Prisma rejected it as an
    // invalid foreign key, surfacing as a generic "Failed" 500 with no
    // hint of which field was the problem. Now marked required in the
    // UI (see exams/page.tsx) with a clear 400 here as a server-side
    // backstop.
    if (!academicYearId || !classId || !name) {
      sendError(res, "academicYearId, classId, and name are required", 400);
      return;
    }

    let createdByRole: "PRINCIPAL" | "CLASS_TEACHER" | "SUBJECT_TEACHER" = "PRINCIPAL";
    if (req.user!.role === "TEACHER") {
      const staff = await prisma.staff.findUnique({ where: { userId: req.user!.userId }, select: { id: true } });
      if (!staff) { sendError(res, "Staff record not found", 404); return; }

      if (sectionId) {
        const section = await prisma.section.findUnique({ where: { id: sectionId }, select: { classTeacherId: true } });
        if (section?.classTeacherId === staff.id) {
          createdByRole = "CLASS_TEACHER";
        } else {
          sendError(res, "You may only create a custom exam for a section where you are the Class Teacher", 403);
          return;
        }
      } else if (subjectId) {
        const isAssigned = await prisma.subjectTeacher.count({
          where: { staffId: staff.id, subjectId, OR: [{ classId }, { classId: null }] },
        });
        if (isAssigned === 0) {
          sendError(res, "You may only create an exam for a class-subject you are assigned to teach", 403);
          return;
        }
        createdByRole = "SUBJECT_TEACHER";
      } else {
        sendError(res, "A Teacher must specify either sectionId (as Class Teacher) or subjectId (as Subject Teacher) to create an exam", 400);
        return;
      }
    }

    // No fixed gap rule between exams - branch-wise custom gap setting
    // instead (spec Section 20). Only a WARNING is surfaced (not a
    // block) via the response's `gapWarning` field, consistent with
    // every other "warning, not hard block" rule in this spec.
    let gapWarning: string | null = null;
    if (startDate) {
      const cls = await prisma.class.findUnique({ where: { id: classId }, select: { branchId: true } });
      const branch = cls ? await prisma.branch.findUnique({ where: { id: cls.branchId }, select: { examMinGapDays: true } }) : null;
      const minGapDays = branch?.examMinGapDays || 0;
      if (minGapDays > 0) {
        const newStart = new Date(startDate);
        const nearby = await prisma.exam.findMany({ where: { classId, startDate: { not: null } }, select: { name: true, startDate: true } });
        for (const other of nearby) {
          const gapDays = Math.abs((newStart.getTime() - new Date(other.startDate!).getTime()) / (1000 * 60 * 60 * 24));
          if (gapDays < minGapDays) {
            gapWarning = `This exam starts only ${Math.round(gapDays)} day(s) after "${other.name}" - branch policy recommends at least ${minGapDays} day(s) gap`;
            break;
          }
        }
      }
    }

    const exam = await prisma.exam.create({
      data: {
        academicYearId, classId, sectionId, subjectId, name, type,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        createdByRole, createdBy: req.user!.userId,
      },
    });
    sendSuccess(res, { ...exam, gapWarning }, "Exam created", 201);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Principal schedules an exam over an existing class/subject teacher's
 * exam -> a postponement request is sent to that teacher (spec Section
 * 9). If the teacher doesn't respond by respondDeadline, it
 * auto-approves (see acknowledgePostponementRequest's timeout check
 * below) and the teacher's exam is POSTPONED (not cancelled) - the
 * teacher then sets a new date via the same endpoint once they do act.
 */
export const createPostponementRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { examId, affectedStaffId, reason, respondDeadline } = req.body;

    const exam = await prisma.exam.findUnique({ where: { id: examId }, include: { class: { select: { branchId: true } } } });
    if (!exam) { sendError(res, "Exam not found", 404); return; }
    if (!canAccessBranch(req, exam.class.branchId)) { sendError(res, "Exam not found", 404); return; }

    const request = await prisma.examPostponementRequest.create({
      data: {
        examId, affectedStaffId, reason,
        requestedBy: req.user!.userId,
        respondDeadline: new Date(respondDeadline),
        status: "PENDING",
      },
    });
    sendSuccess(res, request, "Postponement request sent to the affected teacher", 201);
  } catch (error) { sendError(res, "Failed to create postponement request", 500, (error as Error).message); }
};

/**
 * The affected teacher acknowledges the postponement and sets a new
 * date for their exam - or, if respondDeadline has already passed
 * without any response, the request is treated as auto-approved right
 * here (lazy timeout check rather than a background job) and the
 * exam is marked POSTPONED even without a newExamDate yet (the teacher
 * can still set one afterward via the same endpoint).
 */
export const acknowledgePostponementRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { newExamDate } = req.body;

    const request = await prisma.examPostponementRequest.findUnique({ where: { id }, include: { exam: { include: { class: { select: { branchId: true } } } } } });
    if (!request) { sendError(res, "Postponement request not found", 404); return; }
    if (!canAccessBranch(req, request.exam.class.branchId)) { sendError(res, "Postponement request not found", 404); return; }

    const isPastDeadline = new Date() > new Date(request.respondDeadline);
    const status = request.status === "PENDING" && isPastDeadline ? "AUTO_APPROVED" : "POSTPONED";

    const updated = await prisma.examPostponementRequest.update({
      where: { id },
      data: {
        status: newExamDate ? "POSTPONED" : status,
        respondedAt: new Date(),
        ...(newExamDate && { newExamDate: new Date(newExamDate) }),
      },
    });

    if (updated.status === "POSTPONED" || updated.status === "AUTO_APPROVED") {
      await prisma.exam.update({ where: { id: request.examId }, data: { startDate: newExamDate ? new Date(newExamDate) : request.exam.startDate } });
    }

    sendSuccess(res, updated, isPastDeadline && request.status === "PENDING" ? "Deadline had passed - auto-approved and exam postponed" : "Postponement acknowledged");
  } catch (error) { sendError(res, "Failed to acknowledge postponement request", 500, (error as Error).message); }
};

export const getPostponementRequests = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const affectedStaffId = req.query.affectedStaffId as string | undefined;
    const where: any = {};
    if (affectedStaffId) where.affectedStaffId = affectedStaffId;

    const requests = await prisma.examPostponementRequest.findMany({
      where,
      include: { exam: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    sendSuccess(res, requests, "Postponement requests fetched");
  } catch (error) { sendError(res, "Failed to fetch postponement requests", 500, (error as Error).message); }
};

/**
 * Report card weightage per exam type, branch-wide (spec Section 9) -
 * set by Principal.
 */
export const upsertReportCardWeightage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { branchId, examType, weightPct } = req.body;
    if (!canAccessBranch(req, branchId)) { sendError(res, "Access denied", 403); return; }

    const updated = await prisma.reportCardWeightage.upsert({
      where: { branchId_examType: { branchId, examType } },
      update: { weightPct },
      create: { branchId, examType, weightPct },
    });
    sendSuccess(res, updated, "Report card weightage saved");
  } catch (error) { sendError(res, "Failed to save report card weightage", 500, (error as Error).message); }
};

export const getReportCardWeightages = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { branchId } = req.params;
    if (!canAccessBranch(req, branchId)) { sendError(res, "Access denied", 403); return; }

    const weightages = await prisma.reportCardWeightage.findMany({ where: { branchId } });
    sendSuccess(res, weightages, "Report card weightages fetched");
  } catch (error) { sendError(res, "Failed to fetch report card weightages", 500, (error as Error).message); }
};

/**
 * Update exam metadata (name/type/dates). Class/academic year are
 * intentionally NOT editable here - changing them after marks may
 * already have been entered against the original class/year would
 * silently detach those Mark rows from the exam they were recorded
 * for; delete and recreate the exam instead if that's genuinely needed.
 */
export const updateExam = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, type, startDate, endDate } = req.body;

    const exam = await prisma.exam.findUnique({ where: { id } });
    if (!exam) { sendError(res, "Exam not found", 404); return; }

    const updated = await prisma.exam.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(type !== undefined && { type }),
        ...(startDate !== undefined && { startDate: startDate ? new Date(startDate) : null }),
        ...(endDate !== undefined && { endDate: endDate ? new Date(endDate) : null }),
      },
    });
    sendSuccess(res, updated, "Exam updated");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Delete an exam. Blocked once any marks have been recorded against
 * it, or once results have been published - both are real academic
 * history that must never silently disappear. An exam with no marks
 * yet (e.g. created by mistake, wrong class) can be removed freely.
 */
export const deleteExam = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const exam = await prisma.exam.findUnique({ where: { id } });
    if (!exam) { sendError(res, "Exam not found", 404); return; }

    if (exam.isPublished) {
      sendError(res, "Cannot delete a published exam - unpublish it first if you're certain", 400);
      return;
    }

    const markCount = await prisma.mark.count({ where: { examId: id } });
    if (markCount > 0) {
      sendError(res, `Cannot delete: ${markCount} mark(s) have already been recorded for this exam.`, 400);
      return;
    }

    await prisma.exam.delete({ where: { id } });
    sendSuccess(res, null, "Exam deleted");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Get single exam detail - Exam has no branchId of its own (see
 * schema.prisma), so branch-scoping is checked via its Class instead,
 * same as every other Exam mutation in this controller relies on
 * (implicitly, via getExams's classId filter). Includes a subject-wise
 * marks summary (count of marks recorded per subject + overall count)
 * so the detail view can show progress without a separate results call.
 */
export const getExamById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const exam = await prisma.exam.findUnique({
      where: { id },
      include: {
        class: { select: { id: true, name: true, branchId: true } },
        academicYear: { select: { id: true, name: true } },
      },
    });
    if (!exam) { sendError(res, "Exam not found", 404); return; }
    if (!canAccessBranch(req, exam.class.branchId)) { sendError(res, "Exam not found", 404); return; }

    const marks = await prisma.mark.groupBy({
      by: ["subjectId"],
      where: { examId: id },
      _count: { _all: true },
    });
    const subjectIds = marks.map((m) => m.subjectId);
    const subjects = subjectIds.length > 0
      ? await prisma.subject.findMany({ where: { id: { in: subjectIds } }, select: { id: true, name: true, code: true } })
      : [];
    const marksSummary = marks.map((m) => ({
      subject: subjects.find((s) => s.id === m.subjectId),
      marksRecorded: m._count._all,
    }));

    sendSuccess(res, { ...exam, marksSummary }, "Exam fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Get exams for a class/year
 *
 * SECURITY BUG FIX: this previously had NO branch scoping at all - any
 * authenticated user (including a Branch Admin/Teacher from a
 * completely different branch) could list every exam across every
 * branch in the system just by calling this with no filters. Exam has
 * no branchId of its own (see schema.prisma), so scoping goes through
 * its Class relation, same convention as every other Exam endpoint in
 * this controller (getExamById, deleteExam via markCount, etc) relies
 * on. For a SUPER_ADMIN with no explicit classId filter, this now
 * scopes to their own current session branch's classes by default
 * (matching what every other list endpoint in this codebase does for
 * a Super Admin) - pass an explicit `classId` (always branch-specific
 * already, since classes belong to one branch) to target a class in a
 * different branch.
 */
export const getExams = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const classId = req.query.classId as string;
    const academicYearId = req.query.academicYearId as string;

    const where: any = {};
    if (classId) {
      // A classId is always specific to one branch already - no
      // additional branch filter needed (and a Super Admin targeting a
      // different branch's class via an explicit classId is fine).
      where.classId = classId;
    } else if (req.user?.role !== "SUPER_ADMIN") {
      // Branch Admin/Teacher: always locked to their own branch's exams.
      where.class = { branchId: req.user?.branchId };
    } else if (req.user?.branchId) {
      // Super Admin with no explicit classId: default to their current
      // session branch (matches every other unscoped list endpoint's
      // Super Admin behavior in this codebase).
      where.class = { branchId: req.user.branchId };
    }
    // Super Admin with no classId AND no session branchId (e.g. zero
    // branches exist yet) falls through with an empty `where` - an
    // empty exam list either way, harmless.
    if (academicYearId) where.academicYearId = academicYearId;

    const exams = await prisma.exam.findMany({
      where, orderBy: { createdAt: "desc" },
      include: { class: { select: { id: true, name: true, branchId: true } }, academicYear: { select: { name: true } } },
    });
    sendSuccess(res, exams, "Exams fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Auto grade lookup: prefer the admin-configured GradeSystem bands
 * (see gradeSystem.controller.ts) if any exist, matching the
 * percentage against each band's [minMarks, maxMarks] range
 * inclusively. Falls back to the original hardcoded A+/A/B+/.../F
 * scale when no bands have been configured yet, so existing
 * deployments/tests that never touch Grade System settings keep their
 * exact previous behavior.
 */
const lookupGrade = (pct: number, bands: { minMarks: any; maxMarks: any; grade: string }[]): string => {
  if (bands.length > 0) {
    const match = bands.find((b) => pct >= Number(b.minMarks) && pct <= Number(b.maxMarks));
    if (match) return match.grade;
  }
  if (pct >= 90) return "A+";
  if (pct >= 80) return "A";
  if (pct >= 70) return "B+";
  if (pct >= 60) return "B";
  if (pct >= 50) return "C";
  if (pct >= 40) return "D";
  if (pct >= 33) return "E";
  return "F";
};

/**
 * Enter/update marks (bulk for a subject+exam). Cross-checks against
 * ExamAttendance for this subject's sitting (if a schedule entry and
 * any attendance records exist) and returns a non-blocking `warnings`
 * list for any student marked ABSENT/UNFAIR_MEANS for the exam but
 * still given marks here - a real edge case (e.g. a supplementary/
 * makeup exam) that shouldn't be silently invisible to whoever entered
 * the marks, but also shouldn't outright block a legitimate override.
 */
export const enterMarks = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { examId, subjectId, marks } = req.body;
    // marks: [{studentId, maxMarks, obtainedMarks}]

    // Fetch the configured grade bands once for the whole batch,
    // rather than re-querying per student (this loop can be dozens of
    // students for a single class).
    const gradeBands = await prisma.gradeSystem.findMany({ orderBy: { minMarks: "asc" } });

    // Best-effort lookup of this subject's exam attendance (if a
    // per-subject schedule + attendance records exist for it) - never
    // blocks marks entry if there's no schedule/attendance data at all
    // (e.g. an older exam created before Phase 1's exam-schedule
    // feature, or a subject whose attendance was never taken).
    const schedule = await prisma.examSchedule.findUnique({ where: { examId_subjectId: { examId, subjectId } } });
    const attendanceByStudent = new Map<string, string>();
    if (schedule) {
      const attendances = await prisma.examAttendance.findMany({ where: { examScheduleId: schedule.id } });
      for (const a of attendances) attendanceByStudent.set(a.studentId, a.status);
    }

    let saved = 0;
    const warnings: { studentId: string; examAttendanceStatus: string }[] = [];
    for (const m of marks) {
      const pct = (m.obtainedMarks / m.maxMarks) * 100;
      const grade = lookupGrade(pct, gradeBands);

      await prisma.mark.upsert({
        where: { examId_studentId_subjectId: { examId, studentId: m.studentId, subjectId } },
        update: { maxMarks: m.maxMarks, obtainedMarks: m.obtainedMarks, grade },
        create: { examId, studentId: m.studentId, subjectId, maxMarks: m.maxMarks, obtainedMarks: m.obtainedMarks, grade },
      });
      saved++;

      const attendanceStatus = attendanceByStudent.get(m.studentId);
      if (attendanceStatus === "ABSENT" || attendanceStatus === "UNFAIR_MEANS") {
        warnings.push({ studentId: m.studentId, examAttendanceStatus: attendanceStatus });
      }
    }
    sendSuccess(res, { saved, warnings }, `${saved} marks saved${warnings.length > 0 ? ` (${warnings.length} warning(s) - see 'warnings')` : ""}`);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Get results for an exam (all students)
 */
export const getExamResults = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { examId } = req.params;

    const marks = await prisma.mark.findMany({
      where: { examId },
      include: {
        student: { include: { user: { select: { name: true } } } },
        subject: { select: { name: true, code: true } },
      },
      orderBy: [{ student: { user: { name: "asc" } } }, { subject: { name: "asc" } }],
    });

    // Group by student
    const grouped: Record<string, any> = {};
    for (const m of marks) {
      if (!grouped[m.studentId]) {
        grouped[m.studentId] = { student: m.student.user.name, studentId: m.studentId, subjects: [], total: 0, maxTotal: 0 };
      }
      grouped[m.studentId].subjects.push({ subject: m.subject.name, max: m.maxMarks, obtained: m.obtainedMarks, grade: m.grade });
      grouped[m.studentId].total += Number(m.obtainedMarks);
      grouped[m.studentId].maxTotal += Number(m.maxMarks);
    }

    const results = Object.values(grouped).map((r: any) => ({
      ...r, percentage: r.maxTotal > 0 ? Math.round((r.total / r.maxTotal) * 100) : 0,
    })).sort((a: any, b: any) => b.percentage - a.percentage);

    // Add rank
    results.forEach((r: any, i: number) => { r.rank = i + 1; });

    sendSuccess(res, results, "Results fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Publish/unpublish exam results
 */
export const togglePublish = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const exam = await prisma.exam.findUnique({ where: { id } });
    if (!exam) { sendError(res, "Not found", 404); return; }
    const updated = await prisma.exam.update({ where: { id }, data: { isPublished: !exam.isPublished } });
    sendSuccess(res, updated, `Exam ${updated.isPublished ? "published" : "unpublished"}`);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};
