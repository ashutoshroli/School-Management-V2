import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    attendanceDevice: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
  },
}));

jest.mock("../../services/auditLog.service", () => ({
  logAuditFromRequest: jest.fn(),
}));

import prisma from "../../config/database";
import { createDevice, getDevices, updateDevice } from "../attendanceDevice.controller";
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

describe("attendanceDevice.controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createDevice", () => {
    it("generates a random deviceId and apiKey, scoped to the caller's branch", async () => {
      (prisma.attendanceDevice.create as jest.Mock).mockImplementation(({ data }: any) =>
        Promise.resolve({ id: "device-1", ...data })
      );

      const req = makeReq({ body: { name: "Main Gate Reader", location: "Main Gate" } });
      const res = makeMockRes();

      await createDevice(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      const createCall = (prisma.attendanceDevice.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data.branchId).toBe("branch-1");
      expect(createCall.data.deviceId).toBeTruthy();
      expect(createCall.data.apiKey).toBeTruthy();
      expect(createCall.data.apiKey.length).toBeGreaterThanOrEqual(32);
    });

    it("SECURITY: rejects when the caller tries to create a device for a different branch", async () => {
      const req = makeReq({ body: { name: "X", branchId: "branch-OTHER" } });
      req.query = { branchId: "branch-OTHER" } as any;
      const res = makeMockRes();

      // resolveBranchId for a BRANCH_ADMIN always returns their own
      // branchId regardless of query/body - so this exercises that the
      // device always ends up scoped to req.user.branchId, not an
      // attacker-supplied one.
      (prisma.attendanceDevice.create as jest.Mock).mockImplementation(({ data }: any) =>
        Promise.resolve({ id: "device-1", ...data })
      );

      await createDevice(req, res);

      const createCall = (prisma.attendanceDevice.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data.branchId).toBe("branch-1");
    });
  });

  describe("getDevices", () => {
    it("never includes apiKey in the response payload", async () => {
      (prisma.attendanceDevice.findMany as jest.Mock).mockResolvedValue([]);

      const req = makeReq();
      const res = makeMockRes();

      await getDevices(req, res);

      const findManyCall = (prisma.attendanceDevice.findMany as jest.Mock).mock.calls[0][0];
      expect(findManyCall.select.apiKey).toBeUndefined();
    });

    it("scopes to the caller's branch for non-Super-Admin users", async () => {
      (prisma.attendanceDevice.findMany as jest.Mock).mockResolvedValue([]);
      const req = makeReq();
      const res = makeMockRes();

      await getDevices(req, res);

      expect(prisma.attendanceDevice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { branchId: "branch-1" } })
      );
    });
  });

  describe("updateDevice", () => {
    it("SECURITY: rejects updating a device belonging to a different branch", async () => {
      (prisma.attendanceDevice.findUnique as jest.Mock).mockResolvedValue({ id: "device-1", branchId: "branch-OTHER" });

      const req = makeReq({ params: { id: "device-1" }, body: { isActive: false } });
      const res = makeMockRes();

      await updateDevice(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(prisma.attendanceDevice.update).not.toHaveBeenCalled();
    });

    it("allows deactivating a device within the caller's own branch", async () => {
      (prisma.attendanceDevice.findUnique as jest.Mock).mockResolvedValue({ id: "device-1", branchId: "branch-1" });
      (prisma.attendanceDevice.update as jest.Mock).mockResolvedValue({ id: "device-1", isActive: false });

      const req = makeReq({ params: { id: "device-1" }, body: { isActive: false } });
      const res = makeMockRes();

      await updateDevice(req, res);

      expect(prisma.attendanceDevice.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "device-1" }, data: expect.objectContaining({ isActive: false }) })
      );
    });
  });
});
