jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    attendanceDevice: { findUnique: jest.fn() },
    staff: { findUnique: jest.fn(), findMany: jest.fn() },
    staffAttendance: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), upsert: jest.fn() },
    $transaction: jest.fn(),
  },
}));

import prisma from "../../config/database";
import { cardTapAttendance, markAttendance, bulkMarkAttendance } from "../staffAttendance.controller";
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

describe("staffAttendance.controller - markAttendance", () => {
  const makeMarkReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
    ({
      body: { staffId: "staff-1", date: "2024-03-15", status: "PRESENT" },
      params: {},
      query: {},
      user: { userId: "admin-1", email: "a@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1", organizationId: "org-1" },
      ...overrides,
    } as any);

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ branchId: "branch-1" });
    (prisma.staffAttendance.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.staffAttendance.upsert as jest.Mock).mockResolvedValue({ id: "att-1", status: "PRESENT" });
  });

  it("returns 400 when staffId, date, or status is missing", async () => {
    const req = makeMarkReq({ body: { staffId: "staff-1", date: "2024-03-15" } });
    const res = makeMockRes();

    await markAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 404 when the staff record does not exist", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeMarkReq();
    const res = makeMockRes();

    await markAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects marking attendance for staff in a different branch", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ branchId: "branch-OTHER" });
    const req = makeMarkReq();
    const res = makeMockRes();

    await markAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.staffAttendance.upsert).not.toHaveBeenCalled();
  });

  // BUG FIX regression guard: uses a single atomic upsert instead of
  // the old find-then-create/update pattern, which could throw on a
  // unique-constraint violation if the same request was retried.
  it("BUG FIX: uses a single atomic upsert instead of find-then-create/update", async () => {
    const req = makeMarkReq();
    const res = makeMockRes();

    await markAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(prisma.staffAttendance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { staffId_date: { staffId: "staff-1", date: new Date("2024-03-15") } },
        create: expect.objectContaining({ staffId: "staff-1", status: "PRESENT", source: "MANUAL" }),
      })
    );
    expect(prisma.staffAttendance.create).not.toHaveBeenCalled();
    expect(prisma.staffAttendance.update).not.toHaveBeenCalled();
  });

  it("returns 200 'Attendance updated' when a record already exists for that staff+date", async () => {
    (prisma.staffAttendance.findUnique as jest.Mock).mockResolvedValue({ id: "att-existing" });
    const req = makeMarkReq();
    const res = makeMockRes();

    await markAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Attendance updated" }));
  });
});

describe("staffAttendance.controller - bulkMarkAttendance", () => {
  const makeBulkReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
    ({
      body: {
        date: "2024-03-15",
        records: [
          { staffId: "staff-1", status: "PRESENT" },
          { staffId: "staff-2", status: "ABSENT" },
        ],
      },
      params: {},
      query: {},
      user: { userId: "admin-1", email: "a@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1", organizationId: "org-1" },
      ...overrides,
    } as any);

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.staff.findMany as jest.Mock).mockResolvedValue([
      { id: "staff-1", branchId: "branch-1" },
      { id: "staff-2", branchId: "branch-1" },
    ]);
    (prisma.staffAttendance.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.$transaction as jest.Mock).mockImplementation(async (ops: any[]) => Promise.all(ops));
    (prisma.staffAttendance.upsert as jest.Mock).mockResolvedValue({ id: "att-1" });
  });

  it("returns 400 when date is missing", async () => {
    const req = makeBulkReq({ body: { records: [{ staffId: "staff-1", status: "PRESENT" }] } });
    const res = makeMockRes();

    await bulkMarkAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns 400 when records is empty", async () => {
    const req = makeBulkReq({ body: { date: "2024-03-15", records: [] } });
    const res = makeMockRes();

    await bulkMarkAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 404 when a staffId in the batch does not exist", async () => {
    (prisma.staff.findMany as jest.Mock).mockResolvedValue([{ id: "staff-1", branchId: "branch-1" }]);
    const req = makeBulkReq();
    const res = makeMockRes();

    await bulkMarkAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("SECURITY: rejects a batch containing staff from a different branch", async () => {
    (prisma.staff.findMany as jest.Mock).mockResolvedValue([
      { id: "staff-1", branchId: "branch-1" },
      { id: "staff-2", branchId: "branch-OTHER" },
    ]);
    const req = makeBulkReq();
    const res = makeMockRes();

    await bulkMarkAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // BUG FIX regression guard: this is the exact scenario that used to
  // produce "unable to save attendance" - a batch save request being
  // effectively re-processed (e.g. after a slow network response made
  // the admin click "Save All" again) must succeed cleanly via upsert,
  // not throw a unique-constraint error from a duplicate create().
  it("BUG FIX: saves every record via upsert inside a single transaction, succeeding even if all records already exist", async () => {
    (prisma.staffAttendance.findMany as jest.Mock).mockResolvedValue([
      { staffId: "staff-1" },
      { staffId: "staff-2" },
    ]);
    const req = makeBulkReq();
    const res = makeMockRes();

    await bulkMarkAttendance(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.staffAttendance.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.staffAttendance.create).not.toHaveBeenCalled();
    expect(prisma.staffAttendance.update).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: { created: 0, updated: 2 } }));
  });

  it("reports accurate created/updated counts for a mixed batch", async () => {
    (prisma.staffAttendance.findMany as jest.Mock).mockResolvedValue([{ staffId: "staff-1" }]);
    const req = makeBulkReq();
    const res = makeMockRes();

    await bulkMarkAttendance(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: { created: 1, updated: 1 }, message: "Attendance saved: 1 new, 1 updated" })
    );
  });
});
