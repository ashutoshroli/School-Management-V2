import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    examSchedule: { findUnique: jest.fn() },
    exam: { findUnique: jest.fn() },
    section: { findUnique: jest.fn() },
    examQuestionPaper: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
  },
}));

jest.mock("../../utils/teacherAccess", () => ({
  canTeacherTeachSubjectForClass: jest.fn(),
}));

jest.mock("../../services/storage.service", () => ({
  storage: { save: jest.fn(), deleteByUrl: jest.fn() },
}));

import prisma from "../../config/database";
import { canTeacherTeachSubjectForClass } from "../../utils/teacherAccess";
import { storage } from "../../services/storage.service";
import { uploadExamQuestionPaper, getExamQuestionPapers, deleteExamQuestionPaper } from "../examQuestionPaper.controller";
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
    file: { buffer: Buffer.from("pdf-bytes"), originalname: "paper.pdf", size: 9, mimetype: "application/pdf" },
    ...overrides,
  } as any);

const SCHEDULE = {
  id: "sch-1",
  subjectId: "sub-1",
  exam: { classId: "class-1", class: { id: "class-1", branchId: "branch-1" } },
};

describe("examQuestionPaper.controller - uploadExamQuestionPaper", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.examSchedule.findUnique as jest.Mock).mockResolvedValue(SCHEDULE);
    (canTeacherTeachSubjectForClass as jest.Mock).mockResolvedValue(true);
    (storage.save as jest.Mock).mockResolvedValue({ url: "/uploads/exam-question-papers/sch-1/abc.pdf" });
    (prisma.examQuestionPaper.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "paper-1", ...data }));
  });

  it("returns 400 when no file is uploaded", async () => {
    const req = makeReq({ file: undefined, body: { examScheduleId: "sch-1" } });
    const res = makeMockRes();

    await uploadExamQuestionPaper(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.examQuestionPaper.create).not.toHaveBeenCalled();
  });

  it("returns 400 when examScheduleId is missing", async () => {
    const req = makeReq({ body: {} });
    const res = makeMockRes();

    await uploadExamQuestionPaper(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 404 when the exam schedule entry does not exist", async () => {
    (prisma.examSchedule.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ body: { examScheduleId: "sch-1" } });
    const res = makeMockRes();

    await uploadExamQuestionPaper(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects a schedule entry belonging to a DIFFERENT branch", async () => {
    (prisma.examSchedule.findUnique as jest.Mock).mockResolvedValue({
      ...SCHEDULE,
      exam: { classId: "class-1", class: { id: "class-1", branchId: "branch-OTHER" } },
    });
    const req = makeReq({ body: { examScheduleId: "sch-1" } });
    const res = makeMockRes();

    await uploadExamQuestionPaper(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects a TEACHER who does not teach this subject for this class", async () => {
    (canTeacherTeachSubjectForClass as jest.Mock).mockResolvedValue(false);
    const req = makeReq({ body: { examScheduleId: "sch-1" } });
    const res = makeMockRes();

    await uploadExamQuestionPaper(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.examQuestionPaper.create).not.toHaveBeenCalled();
  });

  it("rejects a sectionId that does not belong to this exam's class", async () => {
    (prisma.section.findUnique as jest.Mock).mockResolvedValue({ classId: "class-OTHER" });
    const req = makeReq({ body: { examScheduleId: "sch-1", sectionId: "sec-1" } });
    const res = makeMockRes();

    await uploadExamQuestionPaper(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.examQuestionPaper.create).not.toHaveBeenCalled();
  });

  it("uploads and records the paper when everything is valid", async () => {
    const req = makeReq({ body: { examScheduleId: "sch-1" } });
    const res = makeMockRes();

    await uploadExamQuestionPaper(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(storage.save).toHaveBeenCalledWith(req.file!.buffer, "paper.pdf", "exam-question-papers/sch-1");
    expect(prisma.examQuestionPaper.create).toHaveBeenCalledWith({
      data: {
        examScheduleId: "sch-1",
        sectionId: null,
        fileUrl: "/uploads/exam-question-papers/sch-1/abc.pdf",
        fileName: "paper.pdf",
        fileSize: 9,
        mimeType: "application/pdf",
        uploadedBy: "teacher-1",
      },
    });
  });

  it("ADMIN roles bypass the teacher-scoping check", async () => {
    (canTeacherTeachSubjectForClass as jest.Mock).mockResolvedValue(true);
    const req = makeReq({
      body: { examScheduleId: "sch-1" },
      user: { userId: "admin-1", email: "a@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" },
    });
    const res = makeMockRes();

    await uploadExamQuestionPaper(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe("examQuestionPaper.controller - getExamQuestionPapers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.examSchedule.findUnique as jest.Mock).mockResolvedValue(SCHEDULE);
    (prisma.exam.findUnique as jest.Mock).mockResolvedValue({ id: "exam-1", class: { branchId: "branch-1" } });
    (prisma.examQuestionPaper.findMany as jest.Mock).mockResolvedValue([]);
  });

  it("returns 400 when NEITHER examScheduleId NOR examId is given", async () => {
    const req = makeReq({ query: {} });
    const res = makeMockRes();

    await getExamQuestionPapers(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 404 when the schedule entry does not exist (examScheduleId filter)", async () => {
    (prisma.examSchedule.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ query: { examScheduleId: "sch-1" } });
    const res = makeMockRes();

    await getExamQuestionPapers(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: a TEACHER only sees their own uploads (uploadedBy filter applied) when filtering by examScheduleId", async () => {
    const req = makeReq({ query: { examScheduleId: "sch-1" } });
    const res = makeMockRes();

    await getExamQuestionPapers(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect((prisma.examQuestionPaper.findMany as jest.Mock).mock.calls[0][0].where).toEqual({
      examScheduleId: "sch-1",
      uploadedBy: "teacher-1",
    });
  });

  it("ADMIN roles see every paper for the schedule entry (no uploadedBy filter)", async () => {
    const req = makeReq({
      query: { examScheduleId: "sch-1" },
      user: { userId: "admin-1", email: "a@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" },
    });
    const res = makeMockRes();

    await getExamQuestionPapers(req, res);

    expect((prisma.examQuestionPaper.findMany as jest.Mock).mock.calls[0][0].where).toEqual({ examScheduleId: "sch-1" });
  });

  // BUG FIX regression tests: the standalone Exam Question Papers
  // page's list view only ever sends `examId` (showing every
  // scheduled subject's papers for the whole exam at once), which this
  // endpoint used to reject outright with a 400 - the frontend
  // swallowed that error silently, so the list always showed "No
  // question papers uploaded yet." even right after a successful
  // upload. See examQuestionPaper.controller.ts's updated doc comment.
  it("REGRESSION: accepts examId alone (no examScheduleId) and filters via the examSchedule relation", async () => {
    const req = makeReq({ query: { examId: "exam-1" } });
    const res = makeMockRes();

    await getExamQuestionPapers(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.exam.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "exam-1" } }));
    expect((prisma.examQuestionPaper.findMany as jest.Mock).mock.calls[0][0].where).toEqual({
      examSchedule: { examId: "exam-1" },
      uploadedBy: "teacher-1",
    });
  });

  it("returns 404 when filtering by an examId that doesn't exist", async () => {
    (prisma.exam.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ query: { examId: "exam-missing" } });
    const res = makeMockRes();

    await getExamQuestionPapers(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects an examId belonging to a DIFFERENT branch", async () => {
    (prisma.exam.findUnique as jest.Mock).mockResolvedValue({ id: "exam-1", class: { branchId: "branch-OTHER" } });
    const req = makeReq({ query: { examId: "exam-1" } });
    const res = makeMockRes();

    await getExamQuestionPapers(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("ADMIN roles see every paper across the exam (no uploadedBy filter) when filtering by examId", async () => {
    const req = makeReq({
      query: { examId: "exam-1" },
      user: { userId: "admin-1", email: "a@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" },
    });
    const res = makeMockRes();

    await getExamQuestionPapers(req, res);

    expect((prisma.examQuestionPaper.findMany as jest.Mock).mock.calls[0][0].where).toEqual({ examSchedule: { examId: "exam-1" } });
  });
});

describe("examQuestionPaper.controller - deleteExamQuestionPaper", () => {
  const PAPER = {
    id: "paper-1",
    uploadedBy: "teacher-1",
    fileUrl: "/uploads/exam-question-papers/sch-1/abc.pdf",
    examSchedule: { exam: { class: { branchId: "branch-1" } } },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.examQuestionPaper.findUnique as jest.Mock).mockResolvedValue(PAPER);
  });

  it("returns 404 when the paper does not exist", async () => {
    (prisma.examQuestionPaper.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { id: "paper-1" } });
    const res = makeMockRes();

    await deleteExamQuestionPaper(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects a paper belonging to a DIFFERENT branch", async () => {
    (prisma.examQuestionPaper.findUnique as jest.Mock).mockResolvedValue({
      ...PAPER,
      examSchedule: { exam: { class: { branchId: "branch-OTHER" } } },
    });
    const req = makeReq({ params: { id: "paper-1" } });
    const res = makeMockRes();

    await deleteExamQuestionPaper(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: a TEACHER cannot delete another teacher's uploaded paper", async () => {
    const req = makeReq({
      params: { id: "paper-1" },
      user: { userId: "teacher-2", email: "t2@test.com", role: UserRole.TEACHER, branchId: "branch-1" },
    });
    const res = makeMockRes();

    await deleteExamQuestionPaper(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.examQuestionPaper.delete).not.toHaveBeenCalled();
  });

  it("allows a TEACHER to delete their OWN uploaded paper", async () => {
    const req = makeReq({ params: { id: "paper-1" } });
    const res = makeMockRes();

    await deleteExamQuestionPaper(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.examQuestionPaper.delete).toHaveBeenCalledWith({ where: { id: "paper-1" } });
    expect(storage.deleteByUrl).toHaveBeenCalledWith(PAPER.fileUrl);
  });

  it("allows an ADMIN to delete any paper in their branch", async () => {
    const req = makeReq({
      params: { id: "paper-1" },
      user: { userId: "admin-1", email: "a@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" },
    });
    const res = makeMockRes();

    await deleteExamQuestionPaper(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });
});
