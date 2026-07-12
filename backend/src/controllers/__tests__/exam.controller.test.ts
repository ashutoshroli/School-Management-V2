import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    gradeSystem: { findMany: jest.fn() },
    mark: { upsert: jest.fn(), groupBy: jest.fn() },
    exam: { findUnique: jest.fn(), findMany: jest.fn() },
    subject: { findMany: jest.fn() },
    examSchedule: { findUnique: jest.fn() },
    examAttendance: { findMany: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { enterMarks, getExamById, getExams } from "../exam.controller";
import { AuthRequest } from "../../types";

const makeMockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const makeReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
  ({
    body: {},
    params: {},
    query: {},
    user: { userId: "teacher-1", email: "t@test.com", role: UserRole.TEACHER, branchId: "branch-1" },
    ...overrides,
  } as any);

// enterMarks's grade assignment now prefers admin-configured
// GradeSystem bands (see gradeSystem.controller.ts) over the original
// hardcoded A+/A/B+/.../F scale, falling back to that scale only when
// no bands are configured - existing deployments/tests that never
// touch Grade System settings must keep their exact previous behavior.
describe("exam.controller - enterMarks grade lookup", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.mark.upsert as jest.Mock).mockResolvedValue({});
    // No per-subject exam schedule exists for these older/basic tests -
    // the exam-attendance cross-check is a no-op (schedule: null) and
    // never blocks marks entry.
    (prisma.examSchedule.findUnique as jest.Mock).mockResolvedValue(null);
  });

  it("falls back to the hardcoded scale when no grade bands are configured", async () => {
    (prisma.gradeSystem.findMany as jest.Mock).mockResolvedValue([]);
    const req = makeReq({
      body: { examId: "exam-1", subjectId: "sub-1", marks: [{ studentId: "stu-1", maxMarks: 100, obtainedMarks: 95 }] },
    });
    const res = makeMockRes();

    await enterMarks(req, res);

    expect((prisma.mark.upsert as jest.Mock).mock.calls[0][0].create.grade).toBe("A+");
  });

  it("uses a configured grade band's label when the percentage falls within its range", async () => {
    (prisma.gradeSystem.findMany as jest.Mock).mockResolvedValue([
      { id: "g1", minMarks: 91, maxMarks: 100, grade: "A1" },
      { id: "g2", minMarks: 81, maxMarks: 90, grade: "A2" },
    ]);
    const req = makeReq({
      body: { examId: "exam-1", subjectId: "sub-1", marks: [{ studentId: "stu-1", maxMarks: 100, obtainedMarks: 95 }] },
    });
    const res = makeMockRes();

    await enterMarks(req, res);

    expect((prisma.mark.upsert as jest.Mock).mock.calls[0][0].create.grade).toBe("A1");
  });

  it("falls back to the hardcoded scale when configured bands don't cover the percentage", async () => {
    (prisma.gradeSystem.findMany as jest.Mock).mockResolvedValue([{ id: "g1", minMarks: 91, maxMarks: 100, grade: "A1" }]);
    const req = makeReq({
      body: { examId: "exam-1", subjectId: "sub-1", marks: [{ studentId: "stu-1", maxMarks: 100, obtainedMarks: 55 }] },
    });
    const res = makeMockRes();

    await enterMarks(req, res);

    expect((prisma.mark.upsert as jest.Mock).mock.calls[0][0].create.grade).toBe("C");
  });

  it("fetches grade bands only once for a whole batch of students", async () => {
    (prisma.gradeSystem.findMany as jest.Mock).mockResolvedValue([]);
    const req = makeReq({
      body: {
        examId: "exam-1",
        subjectId: "sub-1",
        marks: [
          { studentId: "stu-1", maxMarks: 100, obtainedMarks: 95 },
          { studentId: "stu-2", maxMarks: 100, obtainedMarks: 55 },
        ],
      },
    });
    const res = makeMockRes();

    await enterMarks(req, res);

    expect(prisma.gradeSystem.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.mark.upsert).toHaveBeenCalledTimes(2);
  });
});

// New Features Phase 3: enterMarks cross-checks against ExamAttendance
// for this subject's sitting (when one exists) and returns a
// non-blocking `warnings` list - never blocks marks entry, just
// surfaces a real edge case (e.g. supplementary exam for a student who
// was marked absent for the exam).
describe("exam.controller - enterMarks exam-attendance cross-check", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.mark.upsert as jest.Mock).mockResolvedValue({});
    (prisma.gradeSystem.findMany as jest.Mock).mockResolvedValue([]);
  });

  it("returns no warnings when no exam schedule exists for this subject", async () => {
    (prisma.examSchedule.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({
      body: { examId: "exam-1", subjectId: "sub-1", marks: [{ studentId: "stu-1", maxMarks: 100, obtainedMarks: 90 }] },
    });
    const res = makeMockRes();

    await enterMarks(req, res);

    expect(prisma.examAttendance.findMany).not.toHaveBeenCalled();
    const payload = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(payload.warnings).toEqual([]);
  });

  it("returns no warnings when the student was marked PRESENT for the exam", async () => {
    (prisma.examSchedule.findUnique as jest.Mock).mockResolvedValue({ id: "sch-1" });
    (prisma.examAttendance.findMany as jest.Mock).mockResolvedValue([{ studentId: "stu-1", status: "PRESENT" }]);
    const req = makeReq({
      body: { examId: "exam-1", subjectId: "sub-1", marks: [{ studentId: "stu-1", maxMarks: 100, obtainedMarks: 90 }] },
    });
    const res = makeMockRes();

    await enterMarks(req, res);

    const payload = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(payload.warnings).toEqual([]);
  });

  it("warns (but still saves) when marks are entered for a student marked ABSENT for the exam", async () => {
    (prisma.examSchedule.findUnique as jest.Mock).mockResolvedValue({ id: "sch-1" });
    (prisma.examAttendance.findMany as jest.Mock).mockResolvedValue([{ studentId: "stu-1", status: "ABSENT" }]);
    const req = makeReq({
      body: { examId: "exam-1", subjectId: "sub-1", marks: [{ studentId: "stu-1", maxMarks: 100, obtainedMarks: 90 }] },
    });
    const res = makeMockRes();

    await enterMarks(req, res);

    expect(prisma.mark.upsert).toHaveBeenCalledTimes(1);
    const payload = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(payload.saved).toBe(1);
    expect(payload.warnings).toEqual([{ studentId: "stu-1", examAttendanceStatus: "ABSENT" }]);
  });

  it("warns when marks are entered for a student marked UNFAIR_MEANS for the exam", async () => {
    (prisma.examSchedule.findUnique as jest.Mock).mockResolvedValue({ id: "sch-1" });
    (prisma.examAttendance.findMany as jest.Mock).mockResolvedValue([{ studentId: "stu-1", status: "UNFAIR_MEANS" }]);
    const req = makeReq({
      body: { examId: "exam-1", subjectId: "sub-1", marks: [{ studentId: "stu-1", maxMarks: 100, obtainedMarks: 90 }] },
    });
    const res = makeMockRes();

    await enterMarks(req, res);

    const payload = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(payload.warnings).toEqual([{ studentId: "stu-1", examAttendanceStatus: "UNFAIR_MEANS" }]);
  });
});

// Exam has no branchId of its own - branch-scoping is checked via its
// Class relation instead, same pattern getHomeworkById follows.
describe("exam.controller - getExamById", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 404 when the exam does not exist", async () => {
    (prisma.exam.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { id: "exam-1" } });
    const res = makeMockRes();

    await getExamById(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects an exam whose class belongs to a DIFFERENT branch", async () => {
    (prisma.exam.findUnique as jest.Mock).mockResolvedValue({
      id: "exam-1",
      class: { id: "class-1", name: "Class 5", branchId: "branch-OTHER" },
      academicYear: { id: "ay-1", name: "2025-26" },
    });
    const req = makeReq({ params: { id: "exam-1" } });
    const res = makeMockRes();

    await getExamById(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns the exam with a subject-wise marks summary", async () => {
    (prisma.exam.findUnique as jest.Mock).mockResolvedValue({
      id: "exam-1",
      class: { id: "class-1", name: "Class 5", branchId: "branch-1" },
      academicYear: { id: "ay-1", name: "2025-26" },
    });
    (prisma.mark.groupBy as jest.Mock).mockResolvedValue([{ subjectId: "sub-1", _count: { _all: 30 } }]);
    (prisma.subject.findMany as jest.Mock).mockResolvedValue([{ id: "sub-1", name: "Maths", code: "MATH" }]);
    const req = makeReq({ params: { id: "exam-1" } });
    const res = makeMockRes();

    await getExamById(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(payload.marksSummary).toEqual([{ subject: { id: "sub-1", name: "Maths", code: "MATH" }, marksRecorded: 30 }]);
  });

  it("returns an empty marksSummary when no marks have been recorded yet", async () => {
    (prisma.exam.findUnique as jest.Mock).mockResolvedValue({
      id: "exam-1",
      class: { id: "class-1", name: "Class 5", branchId: "branch-1" },
      academicYear: { id: "ay-1", name: "2025-26" },
    });
    (prisma.mark.groupBy as jest.Mock).mockResolvedValue([]);
    const req = makeReq({ params: { id: "exam-1" } });
    const res = makeMockRes();

    await getExamById(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.subject.findMany).not.toHaveBeenCalled();
    const payload = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(payload.marksSummary).toEqual([]);
  });
});


// SECURITY BUG FIX: getExams previously had NO branch scoping at all -
// any authenticated user could list every exam across every branch by
// calling it with no filters. It now scopes through the Exam->Class
// relation for non-Super-Admin roles, and defaults a Super Admin (with
// no explicit classId) to their own current session branch.
describe("exam.controller - getExams (branch scoping)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.exam.findMany as jest.Mock).mockResolvedValue([]);
  });

  it("SECURITY: scopes a TEACHER's unfiltered request to their own branch's classes", async () => {
    const req = makeReq({ query: {} });
    const res = makeMockRes();

    await getExams(req, res);

    expect((prisma.exam.findMany as jest.Mock).mock.calls[0][0].where).toEqual({ class: { branchId: "branch-1" } });
  });

  it("SECURITY: scopes a BRANCH_ADMIN's unfiltered request to their own branch's classes", async () => {
    const req = makeReq({ query: {}, user: { userId: "admin-1", email: "a@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" } });
    const res = makeMockRes();

    await getExams(req, res);

    expect((prisma.exam.findMany as jest.Mock).mock.calls[0][0].where).toEqual({ class: { branchId: "branch-1" } });
  });

  it("does not apply a branch filter when an explicit classId is given (a class is already branch-specific)", async () => {
    const req = makeReq({ query: { classId: "class-1" } });
    const res = makeMockRes();

    await getExams(req, res);

    expect((prisma.exam.findMany as jest.Mock).mock.calls[0][0].where).toEqual({ classId: "class-1" });
  });

  it("defaults a SUPER_ADMIN's unfiltered request to their own current session branch", async () => {
    const req = makeReq({ query: {}, user: { userId: "super-1", email: "s@test.com", role: UserRole.SUPER_ADMIN, branchId: "branch-1" } });
    const res = makeMockRes();

    await getExams(req, res);

    expect((prisma.exam.findMany as jest.Mock).mock.calls[0][0].where).toEqual({ class: { branchId: "branch-1" } });
  });

  it("applies no branch filter for a SUPER_ADMIN with no session branchId at all (e.g. zero branches exist)", async () => {
    const req = makeReq({ query: {}, user: { userId: "super-1", email: "s@test.com", role: UserRole.SUPER_ADMIN, branchId: undefined } });
    const res = makeMockRes();

    await getExams(req, res);

    expect((prisma.exam.findMany as jest.Mock).mock.calls[0][0].where).toEqual({});
  });

  it("still applies an academicYearId filter alongside the branch scoping", async () => {
    const req = makeReq({ query: { academicYearId: "ay-1" } });
    const res = makeMockRes();

    await getExams(req, res);

    expect((prisma.exam.findMany as jest.Mock).mock.calls[0][0].where).toEqual({ class: { branchId: "branch-1" }, academicYearId: "ay-1" });
  });
});
