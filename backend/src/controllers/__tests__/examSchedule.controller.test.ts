import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    exam: { findUnique: jest.fn() },
    classSubject: { count: jest.fn() },
    schoolRoom: { findMany: jest.fn(), findUnique: jest.fn() },
    examSchedule: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    examQuestionPaper: { count: jest.fn() },
    examSeatAllocation: { count: jest.fn() },
    examAttendance: { count: jest.fn() },
    $transaction: jest.fn(),
  },
}));

import prisma from "../../config/database";
import {
  bulkSetExamSchedule,
  getExamSchedule,
  updateExamScheduleEntry,
  deleteExamScheduleEntry,
} from "../examSchedule.controller";
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
    user: { userId: "admin-1", email: "admin@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" },
    ...overrides,
  } as any);

const EXAM = { id: "exam-1", classId: "class-1", class: { id: "class-1", branchId: "branch-1" } };

describe("examSchedule.controller - bulkSetExamSchedule", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.exam.findUnique as jest.Mock).mockResolvedValue(EXAM);
    (prisma.classSubject.count as jest.Mock).mockResolvedValue(2);
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn: any) => fn(prisma));
    (prisma.examSchedule.findMany as jest.Mock).mockResolvedValue([]);
  });

  const validSchedule = [
    { subjectId: "sub-1", examDate: "2026-03-10", startTime: "09:00", endTime: "10:30", durationMinutes: 90, maxMarks: 80 },
    { subjectId: "sub-2", examDate: "2026-03-11", startTime: "09:00", endTime: "10:30", durationMinutes: 90, maxMarks: 80 },
  ];

  it("returns 404 when the exam does not exist", async () => {
    (prisma.exam.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ body: { examId: "exam-1", schedule: validSchedule } });
    const res = makeMockRes();

    await bulkSetExamSchedule(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("SECURITY: rejects an exam belonging to a DIFFERENT branch", async () => {
    (prisma.exam.findUnique as jest.Mock).mockResolvedValue({ id: "exam-1", classId: "class-1", class: { id: "class-1", branchId: "branch-OTHER" } });
    const req = makeReq({ body: { examId: "exam-1", schedule: validSchedule } });
    const res = makeMockRes();

    await bulkSetExamSchedule(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("rejects a schedule with the same subject listed twice", async () => {
    const req = makeReq({
      body: { examId: "exam-1", schedule: [validSchedule[0], { ...validSchedule[0], examDate: "2026-03-12" }] },
    });
    const res = makeMockRes();

    await bulkSetExamSchedule(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects when a subject is not assigned to the exam's class", async () => {
    (prisma.classSubject.count as jest.Mock).mockResolvedValue(1); // only 1 of 2 matched
    const req = makeReq({ body: { examId: "exam-1", schedule: validSchedule } });
    const res = makeMockRes();

    await bulkSetExamSchedule(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects an entry where endTime is not after startTime", async () => {
    const req = makeReq({
      body: { examId: "exam-1", schedule: [{ ...validSchedule[0], startTime: "10:00", endTime: "09:00" }] },
    });
    const res = makeMockRes();

    await bulkSetExamSchedule(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects two subjects on the SAME date whose times overlap", async () => {
    (prisma.classSubject.count as jest.Mock).mockResolvedValue(2);
    const req = makeReq({
      body: {
        examId: "exam-1",
        schedule: [
          { subjectId: "sub-1", examDate: "2026-03-10", startTime: "09:00", endTime: "11:00", durationMinutes: 120, maxMarks: 80 },
          { subjectId: "sub-2", examDate: "2026-03-10", startTime: "10:00", endTime: "12:00", durationMinutes: 120, maxMarks: 80 },
        ],
      },
    });
    const res = makeMockRes();

    await bulkSetExamSchedule(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("allows two subjects on the SAME date with non-overlapping times", async () => {
    (prisma.classSubject.count as jest.Mock).mockResolvedValue(2);
    const req = makeReq({
      body: {
        examId: "exam-1",
        schedule: [
          { subjectId: "sub-1", examDate: "2026-03-10", startTime: "09:00", endTime: "10:30", durationMinutes: 90, maxMarks: 80 },
          { subjectId: "sub-2", examDate: "2026-03-10", startTime: "11:00", endTime: "12:30", durationMinutes: 90, maxMarks: 80 },
        ],
      },
    });
    const res = makeMockRes();

    await bulkSetExamSchedule(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("allows two subjects at the SAME time on DIFFERENT dates (no conflict)", async () => {
    const req = makeReq({ body: { examId: "exam-1", schedule: validSchedule } });
    const res = makeMockRes();

    await bulkSetExamSchedule(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it("SECURITY: rejects a room belonging to a DIFFERENT branch", async () => {
    (prisma.classSubject.count as jest.Mock).mockResolvedValue(1); // schedule below has only 1 subject
    (prisma.schoolRoom.findMany as jest.Mock).mockResolvedValue([
      { id: "room-1", floor: { building: { branchId: "branch-OTHER" } } },
    ]);
    const req = makeReq({
      body: { examId: "exam-1", schedule: [{ ...validSchedule[0], roomId: "room-1" }] },
    });
    const res = makeMockRes();

    await bulkSetExamSchedule(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns 404 when a supplied room does not exist at all", async () => {
    (prisma.classSubject.count as jest.Mock).mockResolvedValue(1); // schedule below has only 1 subject
    (prisma.schoolRoom.findMany as jest.Mock).mockResolvedValue([]);
    const req = makeReq({
      body: { examId: "exam-1", schedule: [{ ...validSchedule[0], roomId: "room-missing" }] },
    });
    const res = makeMockRes();

    await bulkSetExamSchedule(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("saves the schedule (delete + createMany) when everything is valid", async () => {
    const req = makeReq({ body: { examId: "exam-1", schedule: validSchedule } });
    const res = makeMockRes();

    await bulkSetExamSchedule(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.examSchedule.deleteMany).toHaveBeenCalledWith({ where: { examId: "exam-1" } });
    expect(prisma.examSchedule.createMany).toHaveBeenCalled();
  });
});

describe("examSchedule.controller - getExamSchedule", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 404 when the exam does not exist", async () => {
    (prisma.exam.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { examId: "exam-1" } });
    const res = makeMockRes();

    await getExamSchedule(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects an exam belonging to a DIFFERENT branch", async () => {
    (prisma.exam.findUnique as jest.Mock).mockResolvedValue({ id: "exam-1", class: { branchId: "branch-OTHER" } });
    const req = makeReq({ params: { examId: "exam-1" } });
    const res = makeMockRes();

    await getExamSchedule(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns the schedule in chronological order (query ordering)", async () => {
    (prisma.exam.findUnique as jest.Mock).mockResolvedValue({ id: "exam-1", class: { branchId: "branch-1" } });
    (prisma.examSchedule.findMany as jest.Mock).mockResolvedValue([{ id: "sch-1" }]);
    const req = makeReq({ params: { examId: "exam-1" } });
    const res = makeMockRes();

    await getExamSchedule(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect((prisma.examSchedule.findMany as jest.Mock).mock.calls[0][0].orderBy).toEqual([
      { examDate: "asc" },
      { startTime: "asc" },
    ]);
  });
});

describe("examSchedule.controller - updateExamScheduleEntry", () => {
  const ENTRY = {
    id: "sch-1",
    examId: "exam-1",
    examDate: new Date("2026-03-10"),
    startTime: "09:00",
    endTime: "10:30",
    exam: { class: { branchId: "branch-1" } },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.examSchedule.findUnique as jest.Mock).mockResolvedValue(ENTRY);
    (prisma.examSchedule.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.examSchedule.update as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ ...ENTRY, ...data }));
  });

  it("returns 404 when the entry does not exist", async () => {
    (prisma.examSchedule.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { id: "sch-1" }, body: {} });
    const res = makeMockRes();

    await updateExamScheduleEntry(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects an entry belonging to a DIFFERENT branch", async () => {
    (prisma.examSchedule.findUnique as jest.Mock).mockResolvedValue({ ...ENTRY, exam: { class: { branchId: "branch-OTHER" } } });
    const req = makeReq({ params: { id: "sch-1" }, body: {} });
    const res = makeMockRes();

    await updateExamScheduleEntry(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("rejects when the new endTime is not after startTime", async () => {
    const req = makeReq({ params: { id: "sch-1" }, body: { startTime: "11:00", endTime: "10:00" } });
    const res = makeMockRes();

    await updateExamScheduleEntry(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.examSchedule.update).not.toHaveBeenCalled();
  });

  it("rejects when the updated time overlaps a sibling entry on the same date", async () => {
    (prisma.examSchedule.findMany as jest.Mock).mockResolvedValue([
      { id: "sch-2", examDate: new Date("2026-03-10"), startTime: "10:00", endTime: "11:00" },
    ]);
    const req = makeReq({ params: { id: "sch-1" }, body: { startTime: "09:30", endTime: "10:30" } });
    const res = makeMockRes();

    await updateExamScheduleEntry(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.examSchedule.update).not.toHaveBeenCalled();
  });

  it("updates the entry when valid", async () => {
    const req = makeReq({ params: { id: "sch-1" }, body: { maxMarks: 100 } });
    const res = makeMockRes();

    await updateExamScheduleEntry(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.examSchedule.update).toHaveBeenCalled();
  });

  it("SECURITY: rejects a new roomId belonging to a DIFFERENT branch", async () => {
    (prisma.schoolRoom.findUnique as jest.Mock).mockResolvedValue({ id: "room-1", floor: { building: { branchId: "branch-OTHER" } } });
    const req = makeReq({ params: { id: "sch-1" }, body: { roomId: "room-1" } });
    const res = makeMockRes();

    await updateExamScheduleEntry(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.examSchedule.update).not.toHaveBeenCalled();
  });
});

describe("examSchedule.controller - deleteExamScheduleEntry", () => {
  const ENTRY = { id: "sch-1", exam: { class: { branchId: "branch-1" } } };

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.examSchedule.findUnique as jest.Mock).mockResolvedValue(ENTRY);
    (prisma.examQuestionPaper.count as jest.Mock).mockResolvedValue(0);
    (prisma.examSeatAllocation.count as jest.Mock).mockResolvedValue(0);
    (prisma.examAttendance.count as jest.Mock).mockResolvedValue(0);
  });

  it("returns 404 when the entry does not exist", async () => {
    (prisma.examSchedule.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { id: "sch-1" } });
    const res = makeMockRes();

    await deleteExamScheduleEntry(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects an entry belonging to a DIFFERENT branch", async () => {
    (prisma.examSchedule.findUnique as jest.Mock).mockResolvedValue({ id: "sch-1", exam: { class: { branchId: "branch-OTHER" } } });
    const req = makeReq({ params: { id: "sch-1" } });
    const res = makeMockRes();

    await deleteExamScheduleEntry(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("blocks deletion when a question paper has already been uploaded", async () => {
    (prisma.examQuestionPaper.count as jest.Mock).mockResolvedValue(1);
    const req = makeReq({ params: { id: "sch-1" } });
    const res = makeMockRes();

    await deleteExamScheduleEntry(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.examSchedule.delete).not.toHaveBeenCalled();
  });

  it("blocks deletion when a seat allocation exists", async () => {
    (prisma.examSeatAllocation.count as jest.Mock).mockResolvedValue(5);
    const req = makeReq({ params: { id: "sch-1" } });
    const res = makeMockRes();

    await deleteExamScheduleEntry(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("deletes the entry when nothing references it yet", async () => {
    const req = makeReq({ params: { id: "sch-1" } });
    const res = makeMockRes();

    await deleteExamScheduleEntry(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.examSchedule.delete).toHaveBeenCalledWith({ where: { id: "sch-1" } });
  });
});
