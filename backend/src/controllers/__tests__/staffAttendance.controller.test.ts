jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    attendanceDevice: { findUnique: jest.fn() },
    staff: { findUnique: jest.fn() },
    staffAttendance: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { cardTapAttendance } from "../staffAttendance.controller";
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
const STAFF = { id: "staff-1", branchId: "branch-1", cardId: "CARD-STAFF-001" };

describe("staffAttendance.controller - cardTapAttendance", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("SECURITY: rejects a tap with no apiKey at all (regression guard for the pre-fix behavior)", async () => {
    const req = makeReq({ cardId: "CARD-STAFF-001", deviceId: "device-uuid-1" });
    const res = makeMockRes();

    await cardTapAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(prisma.attendanceDevice.findUnique).not.toHaveBeenCalled();
    expect(prisma.staff.findUnique).not.toHaveBeenCalled();
  });

  it("SECURITY: rejects a tap with the wrong apiKey even for a real deviceId", async () => {
    (prisma.attendanceDevice.findUnique as jest.Mock).mockResolvedValue(DEVICE);
    const req = makeReq({ cardId: "CARD-STAFF-001", deviceId: "device-uuid-1", apiKey: "wrong-key" });
    const res = makeMockRes();

    await cardTapAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.staff.findUnique).not.toHaveBeenCalled();
  });

  it("SECURITY: rejects a tap for staff in a different branch than the device", async () => {
    (prisma.attendanceDevice.findUnique as jest.Mock).mockResolvedValue(DEVICE);
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ ...STAFF, branchId: "branch-OTHER" });
    const req = makeReq({ cardId: "CARD-STAFF-001", deviceId: "device-uuid-1", apiKey: DEVICE.apiKey });
    const res = makeMockRes();

    await cardTapAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.staffAttendance.create).not.toHaveBeenCalled();
  });

  it("records an IN tap with valid device credentials and matching branch", async () => {
    (prisma.attendanceDevice.findUnique as jest.Mock).mockResolvedValue(DEVICE);
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue(STAFF);
    (prisma.staffAttendance.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.staffAttendance.create as jest.Mock).mockResolvedValue({ id: "att-1" });

    const req = makeReq({ cardId: "CARD-STAFF-001", deviceId: "device-uuid-1", apiKey: DEVICE.apiKey });
    const res = makeMockRes();

    await cardTapAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(prisma.staffAttendance.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PRESENT", source: "CARD_TAP" }) })
    );
  });

  it("accepts the apiKey via the X-Device-Api-Key header", async () => {
    (prisma.attendanceDevice.findUnique as jest.Mock).mockResolvedValue(DEVICE);
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue(STAFF);
    (prisma.staffAttendance.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.staffAttendance.create as jest.Mock).mockResolvedValue({ id: "att-1" });

    const req = makeReq({ cardId: "CARD-STAFF-001", deviceId: "device-uuid-1" }, { "x-device-api-key": DEVICE.apiKey });
    const res = makeMockRes();

    await cardTapAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("returns 403 for a deactivated device even with the correct apiKey", async () => {
    (prisma.attendanceDevice.findUnique as jest.Mock).mockResolvedValue({ ...DEVICE, isActive: false });
    const req = makeReq({ cardId: "CARD-STAFF-001", deviceId: "device-uuid-1", apiKey: DEVICE.apiKey });
    const res = makeMockRes();

    await cardTapAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("returns 404 for an unregistered card even with valid device credentials", async () => {
    (prisma.attendanceDevice.findUnique as jest.Mock).mockResolvedValue(DEVICE);
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue(null);

    const req = makeReq({ cardId: "CARD-UNKNOWN", deviceId: "device-uuid-1", apiKey: DEVICE.apiKey });
    const res = makeMockRes();

    await cardTapAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
