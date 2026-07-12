import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    examSchedule: { findUnique: jest.fn(), findMany: jest.fn() },
    examSeatAllocation: { findMany: jest.fn() },
    student: { count: jest.fn(), findMany: jest.fn() },
    examAttendance: { upsert: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
    exam: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}));

import prisma from "../../config/database";
import { markExamAttendance, getExamAttendance, getExamAttendanceSummary } from "../examAttendance.controller";
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

const SCHEDULE = { id: "sch-1", examId: "exam-1", exam: { classId: "class-1", class: { id: "class-1", branchId: "branch-1" } } };

describe("examAttendance.controller - markExamAttendance", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.examSchedule.findUnique as jest.Mock).mockResolvedValue(SCHEDULE);
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn: any) => fn(prisma));
    (prisma.examAttendance.upsert as jest.Mock).mockResolvedValue({});
  });

  it("returns 404 when the exam schedule entry does not exist", async () => {
    (prisma.examSchedule.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { examScheduleId: "sch-1" }, body: { records: [{ studentId: "s1", status: "PRESENT" }] } });
    const res = makeMockRes();

    await markExamAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects a schedule entry belonging to a DIFFERENT branch", async () => {
    (prisma.examSchedule.findUnique as jest.Mock).mockResolvedValue({ exam: { classId: "class-1", class: { branchId: "branch-OTHER" } } });
    const req = makeReq({ params: { examScheduleId: "sch-1" }, body: { records: [{ studentId: "s1", status: "PRESENT" }] } });
    const res = makeMockRes();

    await markExamAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 400 when records is empty", async () => {
    const req = makeReq({ params: { examScheduleId: "sch-1" }, body: { records: [] } });
    const res = makeMockRes();

    await markExamAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("SECURITY: rejects marking a student who is NOT seated in the given room (roomId supplied)", async () => {
    (prisma.examSeatAllocation.findMany as jest.Mock).mockResolvedValue([{ studentId: "s1" }]);
    const req = makeReq({
      params: { examScheduleId: "sch-1" },
      body: { roomId: "room-1", records: [{ studentId: "s1", status: "PRESENT" }, { studentId: "s2", status: "PRESENT" }] },
    });
    const res = makeMockRes();

    await markExamAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("allows marking when every student IS seated in the given room", async () => {
    (prisma.examSeatAllocation.findMany as jest.Mock).mockResolvedValue([{ studentId: "s1" }, { studentId: "s2" }]);
    const req = makeReq({
      params: { examScheduleId: "sch-1" },
      body: { roomId: "room-1", records: [{ studentId: "s1", status: "PRESENT" }, { studentId: "s2", status: "ABSENT" }] },
    });
    const res = makeMockRes();

    await markExamAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.examAttendance.upsert).toHaveBeenCalledTimes(2);
  });

  it("rejects a student not belonging to the exam's class when no roomId is given", async () => {
    (prisma.student.count as jest.Mock).mockResolvedValue(1); // only 1 of 2 matched
    const req = makeReq({
      params: { examScheduleId: "sch-1" },
      body: { records: [{ studentId: "s1", status: "PRESENT" }, { studentId: "s2", status: "PRESENT" }] },
    });
    const res = makeMockRes();

    await markExamAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("allows marking without a roomId when every student belongs to the exam's class", async () => {
    (prisma.student.count as jest.Mock).mockResolvedValue(2);
    const req = makeReq({
      params: { examScheduleId: "sch-1" },
      body: { records: [{ studentId: "s1", status: "PRESENT" }, { studentId: "s2", status: "LATE" }] },
    });
    const res = makeMockRes();

    await markExamAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.examAttendance.upsert).toHaveBeenCalledTimes(2);
  });

  it("upserts each record using the examScheduleId_studentId compound key", async () => {
    (prisma.student.count as jest.Mock).mockResolvedValue(1);
    const req = makeReq({
      params: { examScheduleId: "sch-1" },
      body: { records: [{ studentId: "s1", status: "PRESENT", remarks: "arrived early" }] },
    });
    const res = makeMockRes();

    await markExamAttendance(req, res);

    expect(prisma.examAttendance.upsert).toHaveBeenCalledWith({
      where: { examScheduleId_studentId: { examScheduleId: "sch-1", studentId: "s1" } },
      update: { status: "PRESENT", remarks: "arrived early", markedBy: "teacher-1" },
      create: { examScheduleId: "sch-1", studentId: "s1", status: "PRESENT", remarks: "arrived early", markedBy: "teacher-1" },
    });
  });
});

describe("examAttendance.controller - getExamAttendance", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.examSchedule.findUnique as jest.Mock).mockResolvedValue(SCHEDULE);
    (prisma.examAttendance.findMany as jest.Mock).mockResolvedValue([]);
  });

  it("returns 404 when the schedule entry does not exist", async () => {
    (prisma.examSchedule.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { examScheduleId: "sch-1" } });
    const res = makeMockRes();

    await getExamAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("uses SEAT_PLAN source and groups by room when a seat plan exists", async () => {
    (prisma.examSeatAllocation.findMany as jest.Mock).mockResolvedValue([
      { roomId: "room-1", seatNo: 1, studentId: "s1", room: { id: "room-1", roomNo: "101", name: null }, student: { id: "s1", admissionNo: "A1", rollNo: "1", user: { name: "Student One" }, section: { name: "A" } } },
    ]);
    const req = makeReq({ params: { examScheduleId: "sch-1" } });
    const res = makeMockRes();

    await getExamAttendance(req, res);

    const payload = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(payload.source).toBe("SEAT_PLAN");
    expect(payload.rooms).toHaveLength(1);
    expect(payload.rooms[0].students[0].status).toBeNull();
  });

  it("pre-fills existing attendance status for a seated student", async () => {
    (prisma.examSeatAllocation.findMany as jest.Mock).mockResolvedValue([
      { roomId: "room-1", seatNo: 1, studentId: "s1", room: { id: "room-1", roomNo: "101", name: null }, student: { id: "s1", admissionNo: "A1", rollNo: "1", user: { name: "Student One" }, section: { name: "A" } } },
    ]);
    (prisma.examAttendance.findMany as jest.Mock).mockResolvedValue([{ studentId: "s1", status: "PRESENT", remarks: null }]);
    const req = makeReq({ params: { examScheduleId: "sch-1" } });
    const res = makeMockRes();

    await getExamAttendance(req, res);

    const payload = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(payload.rooms[0].students[0].status).toBe("PRESENT");
  });

  it("falls back to CLASS_ROSTER (unroomed) when no seat plan has been generated", async () => {
    (prisma.examSeatAllocation.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.student.findMany as jest.Mock).mockResolvedValue([
      { id: "s1", admissionNo: "A1", rollNo: "1", user: { name: "Student One" }, section: { name: "A" } },
    ]);
    const req = makeReq({ params: { examScheduleId: "sch-1" } });
    const res = makeMockRes();

    await getExamAttendance(req, res);

    const payload = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(payload.source).toBe("CLASS_ROSTER");
    expect(payload.rooms[0].roomId).toBeNull();
    expect(payload.rooms[0].students).toHaveLength(1);
  });
});

describe("examAttendance.controller - getExamAttendanceSummary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 404 when the exam does not exist", async () => {
    (prisma.exam.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { examId: "exam-1" } });
    const res = makeMockRes();

    await getExamAttendanceSummary(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects an exam belonging to a DIFFERENT branch", async () => {
    (prisma.exam.findUnique as jest.Mock).mockResolvedValue({ class: { branchId: "branch-OTHER" } });
    const req = makeReq({ params: { examId: "exam-1" } });
    const res = makeMockRes();

    await getExamAttendanceSummary(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("aggregates per-status counts for every subject sitting in the exam", async () => {
    (prisma.exam.findUnique as jest.Mock).mockResolvedValue({ class: { branchId: "branch-1" } });
    (prisma.examSchedule.findMany as jest.Mock).mockResolvedValue([
      { id: "sch-1", examDate: new Date("2026-03-10"), subject: { id: "sub-1", name: "Maths" } },
    ]);
    (prisma.examAttendance.groupBy as jest.Mock).mockResolvedValue([
      { status: "PRESENT", _count: { _all: 28 } },
      { status: "ABSENT", _count: { _all: 2 } },
    ]);
    const req = makeReq({ params: { examId: "exam-1" } });
    const res = makeMockRes();

    await getExamAttendanceSummary(req, res);

    const payload = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(payload).toEqual([
      { examScheduleId: "sch-1", subject: "Maths", examDate: new Date("2026-03-10"), PRESENT: 28, ABSENT: 2, UNFAIR_MEANS: 0, LATE: 0, totalMarked: 30 },
    ]);
  });
});
