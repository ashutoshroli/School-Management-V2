jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    attendanceDevice: { findUnique: jest.fn() },
    student: { findUnique: jest.fn(), findMany: jest.fn() },
    section: { findUnique: jest.fn() },
    studentAttendance: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), upsert: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock("../../services/notification.service", () => ({
  notifyParentsOfStudent: jest.fn(),
}));

import prisma from "../../config/database";
import { notifyParentsOfStudent } from "../../services/notification.service";
import { studentCardTap, markStudentAttendance } from "../studentAttendance.controller";
import { AuthRequest } from "../../types";
import { UserRole } from "@prisma/client";

const makeMockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const makeReq = (body: any, headers: Record<string, string> = {}): AuthRequest =>
  ({ body, headers, params: {}, query: {} } as any);

const DEVICE = { id: "device-1", branchId: "branch-1", deviceId: "device-uuid-1", apiKey: "secret-key-abc123", isActive: true };
const STUDENT = { id: "student-1", branchId: "branch-1", sectionId: "section-1", cardId: "CARD-001" };

// Let any fire-and-forget async work inside the controller (the
// notifyCardTap IIFE) flush before assertions run.
const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

describe("studentAttendance.controller - studentCardTap", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("SECURITY: rejects a tap with no apiKey at all (regression guard for the pre-fix behavior)", async () => {
    const req = makeReq({ cardId: "CARD-001", deviceId: "device-uuid-1" });
    const res = makeMockRes();

    await studentCardTap(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(prisma.attendanceDevice.findUnique).not.toHaveBeenCalled();
    expect(prisma.student.findUnique).not.toHaveBeenCalled();
  });

  it("SECURITY: rejects a tap with the wrong apiKey even for a real deviceId", async () => {
    (prisma.attendanceDevice.findUnique as jest.Mock).mockResolvedValue(DEVICE);
    const req = makeReq({ cardId: "CARD-001", deviceId: "device-uuid-1", apiKey: "wrong-key" });
    const res = makeMockRes();

    await studentCardTap(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.student.findUnique).not.toHaveBeenCalled();
  });

  it("SECURITY: rejects a tap for a student in a different branch than the device", async () => {
    (prisma.attendanceDevice.findUnique as jest.Mock).mockResolvedValue(DEVICE);
    (prisma.student.findUnique as jest.Mock).mockResolvedValue({ ...STUDENT, branchId: "branch-OTHER" });
    const req = makeReq({ cardId: "CARD-001", deviceId: "device-uuid-1", apiKey: DEVICE.apiKey });
    const res = makeMockRes();

    await studentCardTap(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.studentAttendance.create).not.toHaveBeenCalled();
  });

  it("records an IN tap for a first-time-today tap with a valid apiKey, and notifies parents", async () => {
    (prisma.attendanceDevice.findUnique as jest.Mock).mockResolvedValue(DEVICE);
    (prisma.student.findUnique as jest.Mock)
      .mockResolvedValueOnce(STUDENT) // lookup by cardId inside studentCardTap
      .mockResolvedValueOnce({ ...STUDENT, user: { name: "Ravi Kumar" } }); // lookup inside notifyCardTap
    (prisma.studentAttendance.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.studentAttendance.create as jest.Mock).mockResolvedValue({ id: "att-1" });
    (notifyParentsOfStudent as jest.Mock).mockResolvedValue(undefined);

    const req = makeReq({ cardId: "CARD-001", deviceId: "device-uuid-1", apiKey: DEVICE.apiKey });
    const res = makeMockRes();

    await studentCardTap(req, res);
    await flushMicrotasks();

    expect(res.status).toHaveBeenCalledWith(201);
    expect(prisma.studentAttendance.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PRESENT", source: "CARD_TAP" }) })
    );
    expect(notifyParentsOfStudent).toHaveBeenCalledWith(
      "student-1",
      expect.objectContaining({ type: "ATTENDANCE_IN", channels: ["SMS"] })
    );
  });

  it("also accepts the apiKey via the X-Device-Api-Key header instead of the body", async () => {
    (prisma.attendanceDevice.findUnique as jest.Mock).mockResolvedValue(DEVICE);
    (prisma.student.findUnique as jest.Mock).mockResolvedValueOnce(STUDENT).mockResolvedValueOnce({ ...STUDENT, user: { name: "Ravi" } });
    (prisma.studentAttendance.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.studentAttendance.create as jest.Mock).mockResolvedValue({ id: "att-1" });

    const req = makeReq({ cardId: "CARD-001", deviceId: "device-uuid-1" }, { "x-device-api-key": DEVICE.apiKey });
    const res = makeMockRes();

    await studentCardTap(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("records an OUT tap when an IN record already exists from more than 2 minutes ago", async () => {
    (prisma.attendanceDevice.findUnique as jest.Mock).mockResolvedValue(DEVICE);
    (prisma.student.findUnique as jest.Mock).mockResolvedValueOnce(STUDENT).mockResolvedValueOnce({ ...STUDENT, user: { name: "Ravi" } });
    const inTime = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago
    (prisma.studentAttendance.findFirst as jest.Mock).mockResolvedValue({ id: "att-1", inTime });
    (prisma.studentAttendance.update as jest.Mock).mockResolvedValue({});

    const req = makeReq({ cardId: "CARD-001", deviceId: "device-uuid-1", apiKey: DEVICE.apiKey });
    const res = makeMockRes();

    await studentCardTap(req, res);
    await flushMicrotasks();

    expect(prisma.studentAttendance.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ outTime: expect.any(Date) }) })
    );
    expect(notifyParentsOfStudent).toHaveBeenCalledWith("student-1", expect.objectContaining({ type: "ATTENDANCE_OUT" }));
  });

  it("ignores a duplicate tap within 2 minutes of the IN time (no OUT recorded, no notification)", async () => {
    (prisma.attendanceDevice.findUnique as jest.Mock).mockResolvedValue(DEVICE);
    (prisma.student.findUnique as jest.Mock).mockResolvedValue(STUDENT);
    const inTime = new Date(Date.now() - 60 * 1000); // 1 minute ago
    (prisma.studentAttendance.findFirst as jest.Mock).mockResolvedValue({ id: "att-1", inTime });

    const req = makeReq({ cardId: "CARD-001", deviceId: "device-uuid-1", apiKey: DEVICE.apiKey });
    const res = makeMockRes();

    await studentCardTap(req, res);

    expect(prisma.studentAttendance.update).not.toHaveBeenCalled();
    expect(notifyParentsOfStudent).not.toHaveBeenCalled();
  });

  it("returns 404 for an unregistered card even with valid device credentials", async () => {
    (prisma.attendanceDevice.findUnique as jest.Mock).mockResolvedValue(DEVICE);
    (prisma.student.findUnique as jest.Mock).mockResolvedValue(null);

    const req = makeReq({ cardId: "CARD-UNKNOWN", deviceId: "device-uuid-1", apiKey: DEVICE.apiKey });
    const res = makeMockRes();

    await studentCardTap(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe("studentAttendance.controller - markStudentAttendance", () => {
  const makeAttendanceReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
    ({
      body: {
        sectionId: "section-1",
        date: "2024-03-15",
        records: [
          { studentId: "student-1", status: "PRESENT" },
          { studentId: "student-2", status: "ABSENT" },
        ],
      },
      params: {},
      query: {},
      user: { userId: "teacher-1", email: "t@test.com", role: UserRole.TEACHER, branchId: "branch-1", organizationId: "org-1" },
      ...overrides,
    } as any);

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.section.findUnique as jest.Mock).mockResolvedValue({ branchId: "branch-1" });
    (prisma.studentAttendance.findMany as jest.Mock).mockResolvedValue([]);
    // Mirror the real $transaction(array-of-promises) call shape used
    // by markStudentAttendance - resolve every create/update call it
    // was given.
    (prisma.$transaction as jest.Mock).mockImplementation(async (ops: any[]) => Promise.all(ops));
    (prisma.studentAttendance.create as jest.Mock).mockResolvedValue({ id: "att-1" });
    (prisma.studentAttendance.update as jest.Mock).mockResolvedValue({ id: "att-1" });
  });

  it("returns 400 when sectionId or date is missing", async () => {
    const req = makeAttendanceReq({ body: { date: "2024-03-15", records: [{ studentId: "s1", status: "PRESENT" }] } });
    const res = makeMockRes();

    await markStudentAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns 400 when records is empty or not an array", async () => {
    const req = makeAttendanceReq({ body: { sectionId: "section-1", date: "2024-03-15", records: [] } });
    const res = makeMockRes();

    await markStudentAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns 400 when a record is missing studentId or status", async () => {
    const req = makeAttendanceReq({ body: { sectionId: "section-1", date: "2024-03-15", records: [{ studentId: "s1" }] } });
    const res = makeMockRes();

    await markStudentAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 404 when the section does not exist", async () => {
    (prisma.section.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeAttendanceReq();
    const res = makeMockRes();

    await markStudentAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("SECURITY: rejects marking attendance for a section in a different branch", async () => {
    (prisma.section.findUnique as jest.Mock).mockResolvedValue({ branchId: "branch-OTHER" });
    const req = makeAttendanceReq();
    const res = makeMockRes();

    await markStudentAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // BUG FIX regression guard: `upsert()` against the
  // [studentId, date, period] compound unique key was ITSELF the bug -
  // Prisma's extendedWhereUnique doesn't reliably support nullable
  // fields (period is nullable) in a unique `where` clause (see
  // prisma/prisma#3197, #16880), so upsert() threw on every call for
  // day-wise (period: null) attendance, not just on a retry. The fix
  // avoids that compound-unique `where` entirely: look up via a plain
  // findMany/findFirst (no such limitation), then explicitly
  // create()/update() by real id. This test locks in that
  // create/update is used and upsert() is never called again.
  it("BUG FIX: saves every record via explicit create/update (never upsert against the nullable-period unique key) inside a single transaction", async () => {
    const req = makeAttendanceReq();
    const res = makeMockRes();

    await markStudentAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.studentAttendance.upsert).not.toHaveBeenCalled();
    // Both records are new here (findMany mock resolves to []), so both
    // go through create().
    expect(prisma.studentAttendance.create).toHaveBeenCalledTimes(2);
    expect(prisma.studentAttendance.update).not.toHaveBeenCalled();

    expect(prisma.studentAttendance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          studentId: "student-1",
          date: new Date("2024-03-15"),
          period: null,
          status: "PRESENT",
          source: "MANUAL",
          markedBy: "teacher-1",
        }),
      })
    );
  });

  it("updates an existing record by its real id instead of upserting against the nullable-period compound key", async () => {
    (prisma.studentAttendance.findMany as jest.Mock).mockResolvedValue([
      { id: "existing-att-1", studentId: "student-1" },
    ]);
    const req = makeAttendanceReq();
    const res = makeMockRes();

    await markStudentAttendance(req, res);

    expect(prisma.studentAttendance.update).toHaveBeenCalledWith({
      where: { id: "existing-att-1" },
      data: { status: "PRESENT" },
    });
    expect(prisma.studentAttendance.create).toHaveBeenCalledTimes(1); // only student-2 is new
    expect(prisma.studentAttendance.upsert).not.toHaveBeenCalled();
  });

  it("reports accurate created/updated counts based on which records already existed", async () => {
    (prisma.studentAttendance.findMany as jest.Mock).mockResolvedValue([{ id: "att-existing", studentId: "student-1" }]);
    const req = makeAttendanceReq();
    const res = makeMockRes();

    await markStudentAttendance(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: { created: 1, updated: 1 }, message: "Attendance saved: 1 new, 1 updated" })
    );
  });

  it("still succeeds (transactionally) even if this exact batch was already saved by a prior request", async () => {
    // Simulates re-submitting the same "Save All" click twice - every
    // record already exists from the first request. This must update
    // by real id (never throw), unlike a unique-constraint-based
    // upsert() which was itself broken for this nullable-period model.
    (prisma.studentAttendance.findMany as jest.Mock).mockResolvedValue([
      { id: "att-1", studentId: "student-1" },
      { id: "att-2", studentId: "student-2" },
    ]);
    const req = makeAttendanceReq();
    const res = makeMockRes();

    await markStudentAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: { created: 0, updated: 2 } }));
    expect(prisma.studentAttendance.update).toHaveBeenCalledTimes(2);
    expect(prisma.studentAttendance.create).not.toHaveBeenCalled();
  });
});
