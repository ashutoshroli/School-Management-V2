jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    attendanceDevice: { findUnique: jest.fn() },
    student: { findUnique: jest.fn() },
    studentAttendance: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  },
}));

jest.mock("../../services/notification.service", () => ({
  notifyParentsOfStudent: jest.fn(),
}));

import prisma from "../../config/database";
import { notifyParentsOfStudent } from "../../services/notification.service";
import { studentCardTap } from "../studentAttendance.controller";
import { AuthRequest } from "../../types";

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
