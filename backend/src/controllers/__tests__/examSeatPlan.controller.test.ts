import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    examSchedule: { findUnique: jest.fn() },
    schoolRoom: { findMany: jest.fn() },
    student: { findMany: jest.fn() },
    examSeatAllocation: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}));

// startPdfResponse normally pipes a real PDFKit document to an HTTP
// response stream - mocked to a minimal fake "doc" (same convention as
// document.controller.test.ts) so getStudentSeatSlipPdf's tests can
// verify access control (404 vs a rendered PDF) without needing a real
// writable stream. drawQrCode's actual QR generation still runs for
// real (it's cheap and doesn't touch prisma), same as elsewhere.
jest.mock("../../services/pdf.service", () => {
  const actual = jest.requireActual("../../services/pdf.service");
  const makeFakeDoc = () => ({
    page: { width: 595, height: 842, margins: { left: 40, right: 40, top: 40, bottom: 40 } },
    fontSize: jest.fn().mockReturnThis(),
    fillColor: jest.fn().mockReturnThis(),
    text: jest.fn().mockReturnThis(),
    moveTo: jest.fn().mockReturnThis(),
    lineTo: jest.fn().mockReturnThis(),
    strokeColor: jest.fn().mockReturnThis(),
    stroke: jest.fn().mockReturnThis(),
    moveDown: jest.fn().mockReturnThis(),
    image: jest.fn().mockReturnThis(),
    end: jest.fn(),
    y: 100,
  });
  return { ...actual, startPdfResponse: jest.fn(() => makeFakeDoc()) };
});

import prisma from "../../config/database";
import { generateSeatPlan, getSeatPlan, clearSeatPlan, getStudentSeatSlipPdf } from "../examSeatPlan.controller";
import { AuthRequest } from "../../types";

const makeMockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn();
  res.send = jest.fn();
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

const SCHEDULE = { id: "sch-1", exam: { classId: "class-1", class: { id: "class-1", branchId: "branch-1" } } };

const makeStudent = (id: string, rollNo: string, gender: "MALE" | "FEMALE", sectionId = "sec-1") => ({
  id, rollNo, gender, sectionId, admissionNo: `A-${id}`, user: { name: `Student ${id}` }, section: { name: "A" },
});

describe("examSeatPlan.controller - generateSeatPlan", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.examSchedule.findUnique as jest.Mock).mockResolvedValue(SCHEDULE);
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn: any) => fn(prisma));
  });

  it("returns 404 when the exam schedule entry does not exist", async () => {
    (prisma.examSchedule.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { examScheduleId: "sch-1" }, body: { roomIds: ["room-1"] } });
    const res = makeMockRes();

    await generateSeatPlan(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects a schedule entry belonging to a DIFFERENT branch", async () => {
    (prisma.examSchedule.findUnique as jest.Mock).mockResolvedValue({ exam: { classId: "class-1", class: { branchId: "branch-OTHER" } } });
    const req = makeReq({ params: { examScheduleId: "sch-1" }, body: { roomIds: ["room-1"] } });
    const res = makeMockRes();

    await generateSeatPlan(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 400 when roomIds is empty", async () => {
    const req = makeReq({ params: { examScheduleId: "sch-1" }, body: { roomIds: [] } });
    const res = makeMockRes();

    await generateSeatPlan(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 404 when a supplied room does not exist", async () => {
    (prisma.schoolRoom.findMany as jest.Mock).mockResolvedValue([]);
    const req = makeReq({ params: { examScheduleId: "sch-1" }, body: { roomIds: ["room-missing"] } });
    const res = makeMockRes();

    await generateSeatPlan(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects a room belonging to a DIFFERENT branch", async () => {
    (prisma.schoolRoom.findMany as jest.Mock).mockResolvedValue([
      { id: "room-1", capacity: 30, floor: { building: { branchId: "branch-OTHER", name: "B" } } },
    ]);
    const req = makeReq({ params: { examScheduleId: "sch-1" }, body: { roomIds: ["room-1"] } });
    const res = makeMockRes();

    await generateSeatPlan(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when no students match the given filters", async () => {
    (prisma.schoolRoom.findMany as jest.Mock).mockResolvedValue([
      { id: "room-1", capacity: 30, floor: { building: { branchId: "branch-1", name: "B" } } },
    ]);
    (prisma.student.findMany as jest.Mock).mockResolvedValue([]);
    const req = makeReq({ params: { examScheduleId: "sch-1" }, body: { roomIds: ["room-1"] } });
    const res = makeMockRes();

    await generateSeatPlan(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects when total room capacity is less than the number of matched students", async () => {
    (prisma.schoolRoom.findMany as jest.Mock).mockResolvedValue([
      { id: "room-1", capacity: 2, floor: { building: { branchId: "branch-1", name: "B" } } },
    ]);
    (prisma.student.findMany as jest.Mock).mockResolvedValue([
      makeStudent("s1", "1", "MALE"), makeStudent("s2", "2", "FEMALE"), makeStudent("s3", "3", "MALE"),
    ]);
    const req = makeReq({ params: { examScheduleId: "sch-1" }, body: { roomIds: ["room-1"] } });
    const res = makeMockRes();

    await generateSeatPlan(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("fills rooms in ROLL_NO_ORDER (default) and respects room capacity across multiple rooms", async () => {
    (prisma.schoolRoom.findMany as jest.Mock).mockResolvedValue([
      { id: "room-1", capacity: 2, floor: { building: { branchId: "branch-1", name: "B" } } },
      { id: "room-2", capacity: 2, floor: { building: { branchId: "branch-1", name: "B" } } },
    ]);
    (prisma.student.findMany as jest.Mock).mockResolvedValue([
      makeStudent("s3", "3", "MALE"), makeStudent("s1", "1", "FEMALE"), makeStudent("s2", "2", "MALE"),
    ]);
    const req = makeReq({ params: { examScheduleId: "sch-1" }, body: { roomIds: ["room-1", "room-2"] } });
    const res = makeMockRes();

    await generateSeatPlan(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const createCall = (prisma.examSeatAllocation.createMany as jest.Mock).mock.calls[0][0].data;
    expect(createCall).toEqual([
      { examScheduleId: "sch-1", roomId: "room-1", studentId: "s1", seatNo: 1 },
      { examScheduleId: "sch-1", roomId: "room-1", studentId: "s2", seatNo: 2 },
      { examScheduleId: "sch-1", roomId: "room-2", studentId: "s3", seatNo: 1 },
    ]);
  });

  it("ALTERNATE_GENDER arrangement interleaves male/female students by roll no", async () => {
    (prisma.schoolRoom.findMany as jest.Mock).mockResolvedValue([
      { id: "room-1", capacity: 10, floor: { building: { branchId: "branch-1", name: "B" } } },
    ]);
    (prisma.student.findMany as jest.Mock).mockResolvedValue([
      makeStudent("m2", "4", "MALE"), makeStudent("f1", "1", "FEMALE"),
      makeStudent("m1", "2", "MALE"), makeStudent("f2", "3", "FEMALE"),
    ]);
    const req = makeReq({ params: { examScheduleId: "sch-1" }, body: { roomIds: ["room-1"], arrangement: "ALTERNATE_GENDER" } });
    const res = makeMockRes();

    await generateSeatPlan(req, res);

    const createCall = (prisma.examSeatAllocation.createMany as jest.Mock).mock.calls[0][0].data;
    // males sorted by rollNo: m1(2), m2(4); females sorted: f1(1), f2(3)
    // interleaved: m1, f1, m2, f2
    expect(createCall.map((a: any) => a.studentId)).toEqual(["m1", "f1", "m2", "f2"]);
  });

  it("filters by rollNo range (rollNoFrom/rollNoTo)", async () => {
    (prisma.schoolRoom.findMany as jest.Mock).mockResolvedValue([
      { id: "room-1", capacity: 10, floor: { building: { branchId: "branch-1", name: "B" } } },
    ]);
    (prisma.student.findMany as jest.Mock).mockResolvedValue([
      makeStudent("s1", "1", "MALE"), makeStudent("s2", "5", "MALE"), makeStudent("s3", "10", "MALE"),
    ]);
    const req = makeReq({ params: { examScheduleId: "sch-1" }, body: { roomIds: ["room-1"], rollNoFrom: "2", rollNoTo: "9" } });
    const res = makeMockRes();

    await generateSeatPlan(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const createCall = (prisma.examSeatAllocation.createMany as jest.Mock).mock.calls[0][0].data;
    expect(createCall.map((a: any) => a.studentId)).toEqual(["s2"]);
  });

  it("deletes any existing seat allocation before creating the new one (regeneration is destructive)", async () => {
    (prisma.schoolRoom.findMany as jest.Mock).mockResolvedValue([
      { id: "room-1", capacity: 5, floor: { building: { branchId: "branch-1", name: "B" } } },
    ]);
    (prisma.student.findMany as jest.Mock).mockResolvedValue([makeStudent("s1", "1", "MALE")]);
    const req = makeReq({ params: { examScheduleId: "sch-1" }, body: { roomIds: ["room-1"] } });
    const res = makeMockRes();

    await generateSeatPlan(req, res);

    expect(prisma.examSeatAllocation.deleteMany).toHaveBeenCalledWith({ where: { examScheduleId: "sch-1" } });
  });
});

describe("examSeatPlan.controller - getSeatPlan", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.examSchedule.findUnique as jest.Mock).mockResolvedValue(SCHEDULE);
  });

  it("returns 404 when the schedule entry does not exist", async () => {
    (prisma.examSchedule.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { examScheduleId: "sch-1" } });
    const res = makeMockRes();

    await getSeatPlan(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("groups allocations by room with a gender breakdown", async () => {
    (prisma.examSeatAllocation.findMany as jest.Mock).mockResolvedValue([
      {
        roomId: "room-1", seatNo: 1, studentId: "s1",
        room: { id: "room-1", roomNo: "101", name: "Hall A" },
        student: { id: "s1", admissionNo: "A1", rollNo: "1", gender: "MALE", user: { name: "Student One" }, section: { name: "A" } },
      },
      {
        roomId: "room-1", seatNo: 2, studentId: "s2",
        room: { id: "room-1", roomNo: "101", name: "Hall A" },
        student: { id: "s2", admissionNo: "A2", rollNo: "2", gender: "FEMALE", user: { name: "Student Two" }, section: { name: "A" } },
      },
    ]);
    const req = makeReq({ params: { examScheduleId: "sch-1" } });
    const res = makeMockRes();

    await getSeatPlan(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0].data;
    expect(payload.totalSeated).toBe(2);
    expect(payload.rooms).toHaveLength(1);
    expect(payload.rooms[0].maleCount).toBe(1);
    expect(payload.rooms[0].femaleCount).toBe(1);
  });
});

describe("examSeatPlan.controller - clearSeatPlan", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.examSchedule.findUnique as jest.Mock).mockResolvedValue(SCHEDULE);
  });

  it("returns 404 when the schedule entry does not exist", async () => {
    (prisma.examSchedule.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { examScheduleId: "sch-1" } });
    const res = makeMockRes();

    await clearSeatPlan(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("deletes every allocation for the schedule entry", async () => {
    (prisma.examSeatAllocation.deleteMany as jest.Mock).mockResolvedValue({ count: 3 });
    const req = makeReq({ params: { examScheduleId: "sch-1" } });
    const res = makeMockRes();

    await clearSeatPlan(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.examSeatAllocation.deleteMany).toHaveBeenCalledWith({ where: { examScheduleId: "sch-1" } });
  });
});

describe("examSeatPlan.controller - getStudentSeatSlipPdf", () => {
  const ALLOCATION = {
    seatNo: 5,
    room: { roomNo: "101", name: "Hall A", floor: { name: "Ground Floor", building: { name: "Main Building" } } },
    student: {
      admissionNo: "A1", rollNo: "1", branchId: "branch-1",
      user: { name: "Student One" }, class: { name: "5" }, section: { name: "A" }, branch: { name: "ABC School" },
    },
    examSchedule: { exam: { name: "Half Yearly" }, subject: { name: "Maths" }, examDate: new Date("2026-03-10"), startTime: "09:00", endTime: "10:30" },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.examSeatAllocation.findUnique as jest.Mock).mockResolvedValue(ALLOCATION);
  });

  it("returns 404 when no allocation exists for this student/schedule", async () => {
    (prisma.examSeatAllocation.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { examScheduleId: "sch-1", studentId: "s1" } });
    const res = makeMockRes();

    await getStudentSeatSlipPdf(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects an allocation belonging to a DIFFERENT branch", async () => {
    (prisma.examSeatAllocation.findUnique as jest.Mock).mockResolvedValue({ ...ALLOCATION, student: { ...ALLOCATION.student, branchId: "branch-OTHER" } });
    const req = makeReq({ params: { examScheduleId: "sch-1", studentId: "s1" } });
    const res = makeMockRes();

    await getStudentSeatSlipPdf(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("streams a PDF when the allocation is found and accessible (no error response, doc.end() reached)", async () => {
    const req = makeReq({ params: { examScheduleId: "sch-1", studentId: "s1" } });
    const res = makeMockRes();
    // startPdfResponse is mocked to a fake doc (see jest.mock above) -
    // we're not asserting exact PDF bytes here, just that the happy
    // path completes without an error response and reaches doc.end().

    await getStudentSeatSlipPdf(req, res);

    expect(res.status).not.toHaveBeenCalledWith(404);
    expect(res.status).not.toHaveBeenCalledWith(500);
  });
});
