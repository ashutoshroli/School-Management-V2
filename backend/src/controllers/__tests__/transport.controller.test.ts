import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    transportRoute: { create: jest.fn() },
    vehicle: { create: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { createRoute, addVehicle } from "../transport.controller";
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

describe("transport.controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createRoute", () => {
    beforeEach(() => {
      (prisma.transportRoute.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "route-1", ...data }));
    });

    it("BUG FIX: falls back to the caller's own branch when the client sends an empty branchId", async () => {
      const req = makeReq({ body: { branchId: "", name: "Route 1", startPoint: "A", endPoint: "B", monthlyFee: 500 } });
      const res = makeMockRes();

      await createRoute(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect((prisma.transportRoute.create as jest.Mock).mock.calls[0][0].data.branchId).toBe("branch-1");
    });

    it("returns 400 when no branchId can be resolved", async () => {
      const req = makeReq({
        body: { branchId: "", name: "Route 1" },
        user: { userId: "u1", email: "e", role: UserRole.ACCOUNTANT, branchId: undefined },
      });
      const res = makeMockRes();

      await createRoute(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(prisma.transportRoute.create).not.toHaveBeenCalled();
    });

    it("SECURITY: silently neutralizes a Branch Admin trying to target a different branch (creates under their own branch instead)", async () => {
      const req = makeReq({ body: { branchId: "branch-OTHER", name: "Route 1", startPoint: "A", endPoint: "B", monthlyFee: 500 } });
      const res = makeMockRes();

      await createRoute(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect((prisma.transportRoute.create as jest.Mock).mock.calls[0][0].data.branchId).toBe("branch-1");
    });
  });

  describe("addVehicle", () => {
    beforeEach(() => {
      (prisma.vehicle.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "vehicle-1", ...data }));
    });

    it("BUG FIX: falls back to the caller's own branch when the client sends an empty branchId", async () => {
      const req = makeReq({ body: { branchId: "", vehicleNo: "DL01AB1234", type: "Bus", capacity: 40 } });
      const res = makeMockRes();

      await addVehicle(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect((prisma.vehicle.create as jest.Mock).mock.calls[0][0].data.branchId).toBe("branch-1");
    });

    it("SECURITY: silently neutralizes a Branch Admin trying to target a different branch (creates under their own branch instead)", async () => {
      const req = makeReq({ body: { branchId: "branch-OTHER", vehicleNo: "DL01AB1234", type: "Bus", capacity: 40 } });
      const res = makeMockRes();

      await addVehicle(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect((prisma.vehicle.create as jest.Mock).mock.calls[0][0].data.branchId).toBe("branch-1");
    });
  });
});
