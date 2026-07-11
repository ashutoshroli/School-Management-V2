import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    transportRoute: { create: jest.fn(), findUnique: jest.fn() },
    transportStop: { create: jest.fn() },
    vehicle: { create: jest.fn(), findUnique: jest.fn() },
    student: { findUnique: jest.fn() },
    transportAllocation: { upsert: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
    vehicleRoute: { findUnique: jest.fn(), create: jest.fn(), delete: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { createRoute, addStop, addVehicle, allocateStudent, removeAllocation, assignVehicleToRoute, unassignVehicleFromRoute } from "../transport.controller";
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

  describe("addStop (SECURITY: branch-access fix)", () => {
    beforeEach(() => {
      (prisma.transportStop.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "stop-1", ...data }));
    });

    it("returns 404 when the route does not exist", async () => {
      (prisma.transportRoute.findUnique as jest.Mock).mockResolvedValue(null);
      const req = makeReq({ body: { routeId: "route-1", name: "Main Gate", order: 1, time: "07:30" } });
      const res = makeMockRes();

      await addStop(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(prisma.transportStop.create).not.toHaveBeenCalled();
    });

    it("SECURITY: rejects adding a stop to a route in a DIFFERENT branch", async () => {
      (prisma.transportRoute.findUnique as jest.Mock).mockResolvedValue({ id: "route-1", branchId: "branch-OTHER" });
      const req = makeReq({ body: { routeId: "route-1", name: "Main Gate", order: 1, time: "07:30" } });
      const res = makeMockRes();

      await addStop(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(prisma.transportStop.create).not.toHaveBeenCalled();
    });

    it("adds the stop when the route is in the caller's own branch", async () => {
      (prisma.transportRoute.findUnique as jest.Mock).mockResolvedValue({ id: "route-1", branchId: "branch-1" });
      const req = makeReq({ body: { routeId: "route-1", name: "Main Gate", order: 1, time: "07:30" } });
      const res = makeMockRes();

      await addStop(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(prisma.transportStop.create).toHaveBeenCalledWith({
        data: { routeId: "route-1", name: "Main Gate", order: 1, time: "07:30" },
      });
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

  describe("allocateStudent", () => {
    const ROUTE = { id: "route-1", branchId: "branch-1" };
    const STUDENT = { branchId: "branch-1" };

    beforeEach(() => {
      (prisma.transportRoute.findUnique as jest.Mock).mockResolvedValue(ROUTE);
      (prisma.student.findUnique as jest.Mock).mockResolvedValue(STUDENT);
      (prisma.transportAllocation.upsert as jest.Mock).mockResolvedValue({ studentId: "student-1", routeId: "route-1" });
    });

    it("returns 400 when studentId or routeId is missing", async () => {
      const req = makeReq({ body: { routeId: "route-1" } });
      const res = makeMockRes();

      await allocateStudent(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(prisma.transportAllocation.upsert).not.toHaveBeenCalled();
    });

    it("returns 404 when the route does not exist", async () => {
      (prisma.transportRoute.findUnique as jest.Mock).mockResolvedValue(null);
      const req = makeReq({ body: { studentId: "student-1", routeId: "route-1" } });
      const res = makeMockRes();

      await allocateStudent(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("SECURITY: rejects a route from a different branch", async () => {
      (prisma.transportRoute.findUnique as jest.Mock).mockResolvedValue({ id: "route-1", branchId: "branch-OTHER" });
      const req = makeReq({ body: { studentId: "student-1", routeId: "route-1" } });
      const res = makeMockRes();

      await allocateStudent(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(prisma.student.findUnique).not.toHaveBeenCalled();
    });

    it("returns 404 when the student does not exist", async () => {
      (prisma.student.findUnique as jest.Mock).mockResolvedValue(null);
      const req = makeReq({ body: { studentId: "student-1", routeId: "route-1" } });
      const res = makeMockRes();

      await allocateStudent(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(prisma.transportAllocation.upsert).not.toHaveBeenCalled();
    });

    // SECURITY: a studentId is just a string from the request body -
    // without this check, a Branch Admin could allocate (and later
    // get a transport fee assigned to) a student who belongs to a
    // completely different branch's route.
    it("SECURITY: rejects a student from a different branch than the route", async () => {
      (prisma.student.findUnique as jest.Mock).mockResolvedValue({ branchId: "branch-OTHER" });
      const req = makeReq({ body: { studentId: "student-1", routeId: "route-1" } });
      const res = makeMockRes();

      await allocateStudent(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(prisma.transportAllocation.upsert).not.toHaveBeenCalled();
    });

    it("allocates the student to the route when everything checks out", async () => {
      const req = makeReq({ body: { studentId: "student-1", routeId: "route-1", stopName: "Main Gate" } });
      const res = makeMockRes();

      await allocateStudent(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(prisma.transportAllocation.upsert).toHaveBeenCalledWith({
        where: { studentId: "student-1" },
        update: { routeId: "route-1", stopName: "Main Gate" },
        create: { studentId: "student-1", routeId: "route-1", stopName: "Main Gate" },
      });
    });
  });

  describe("removeAllocation", () => {
    it("removes the allocation when it exists in the caller's branch", async () => {
      (prisma.transportAllocation.findUnique as jest.Mock).mockResolvedValue({
        studentId: "student-1",
        route: { branchId: "branch-1" },
      });
      const req = makeReq({ params: { studentId: "student-1" } });
      const res = makeMockRes();

      await removeAllocation(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(prisma.transportAllocation.delete).toHaveBeenCalledWith({ where: { studentId: "student-1" } });
    });

    it("returns 404 when the student has no allocation", async () => {
      (prisma.transportAllocation.findUnique as jest.Mock).mockResolvedValue(null);
      const req = makeReq({ params: { studentId: "student-1" } });
      const res = makeMockRes();

      await removeAllocation(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(prisma.transportAllocation.delete).not.toHaveBeenCalled();
    });

    it("SECURITY: rejects removing an allocation belonging to a different branch's route", async () => {
      (prisma.transportAllocation.findUnique as jest.Mock).mockResolvedValue({
        studentId: "student-1",
        route: { branchId: "branch-OTHER" },
      });
      const req = makeReq({ params: { studentId: "student-1" } });
      const res = makeMockRes();

      await removeAllocation(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(prisma.transportAllocation.delete).not.toHaveBeenCalled();
    });
  });

  // Item A - Phase 1 (BACKEND_UX_GAP_PLAN.md): VehicleRoute existed in
  // the schema and was referenced in delete-cleanup code, but there
  // was NO endpoint anywhere that could ever create a row in it.
  describe("assignVehicleToRoute", () => {
    const VEHICLE = { id: "vehicle-1", branchId: "branch-1" };
    const ROUTE = { id: "route-1", branchId: "branch-1" };

    beforeEach(() => {
      (prisma.vehicle.findUnique as jest.Mock).mockResolvedValue(VEHICLE);
      (prisma.transportRoute.findUnique as jest.Mock).mockResolvedValue(ROUTE);
      (prisma.vehicleRoute.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.vehicleRoute.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "vr-1", ...data }));
    });

    it("assigns a vehicle to a route when both are in the caller's branch", async () => {
      const req = makeReq({ body: { vehicleId: "vehicle-1", routeId: "route-1" } });
      const res = makeMockRes();

      await assignVehicleToRoute(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(prisma.vehicleRoute.create).toHaveBeenCalledWith({ data: { vehicleId: "vehicle-1", routeId: "route-1" } });
    });

    it("returns 404 when the vehicle does not exist", async () => {
      (prisma.vehicle.findUnique as jest.Mock).mockResolvedValue(null);
      const req = makeReq({ body: { vehicleId: "vehicle-1", routeId: "route-1" } });
      const res = makeMockRes();

      await assignVehicleToRoute(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(prisma.vehicleRoute.create).not.toHaveBeenCalled();
    });

    it("returns 404 when the route does not exist", async () => {
      (prisma.transportRoute.findUnique as jest.Mock).mockResolvedValue(null);
      const req = makeReq({ body: { vehicleId: "vehicle-1", routeId: "route-1" } });
      const res = makeMockRes();

      await assignVehicleToRoute(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(prisma.vehicleRoute.create).not.toHaveBeenCalled();
    });

    it("SECURITY: rejects a vehicle from a different branch", async () => {
      (prisma.vehicle.findUnique as jest.Mock).mockResolvedValue({ id: "vehicle-1", branchId: "branch-OTHER" });
      const req = makeReq({ body: { vehicleId: "vehicle-1", routeId: "route-1" } });
      const res = makeMockRes();

      await assignVehicleToRoute(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(prisma.vehicleRoute.create).not.toHaveBeenCalled();
    });

    it("SECURITY: rejects a route from a different branch", async () => {
      (prisma.transportRoute.findUnique as jest.Mock).mockResolvedValue({ id: "route-1", branchId: "branch-OTHER" });
      const req = makeReq({ body: { vehicleId: "vehicle-1", routeId: "route-1" } });
      const res = makeMockRes();

      await assignVehicleToRoute(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(prisma.vehicleRoute.create).not.toHaveBeenCalled();
    });

    it("DATA INTEGRITY: rejects when the vehicle and route belong to different branches from each other (even if both are otherwise accessible)", async () => {
      (prisma.vehicle.findUnique as jest.Mock).mockResolvedValue({ id: "vehicle-1", branchId: "branch-1" });
      (prisma.transportRoute.findUnique as jest.Mock).mockResolvedValue({ id: "route-1", branchId: "branch-2" });
      const req = makeReq({
        body: { vehicleId: "vehicle-1", routeId: "route-1" },
        user: { userId: "super-1", email: "e", role: UserRole.SUPER_ADMIN, branchId: undefined },
      });
      const res = makeMockRes();

      await assignVehicleToRoute(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(prisma.vehicleRoute.create).not.toHaveBeenCalled();
    });

    it("rejects a duplicate assignment", async () => {
      (prisma.vehicleRoute.findUnique as jest.Mock).mockResolvedValue({ id: "vr-existing" });
      const req = makeReq({ body: { vehicleId: "vehicle-1", routeId: "route-1" } });
      const res = makeMockRes();

      await assignVehicleToRoute(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(prisma.vehicleRoute.create).not.toHaveBeenCalled();
    });
  });

  describe("unassignVehicleFromRoute", () => {
    it("removes the assignment when it exists in the caller's branch", async () => {
      (prisma.vehicle.findUnique as jest.Mock).mockResolvedValue({ id: "vehicle-1", branchId: "branch-1" });
      (prisma.vehicleRoute.findUnique as jest.Mock).mockResolvedValue({ id: "vr-1" });
      const req = makeReq({ params: { vehicleId: "vehicle-1", routeId: "route-1" } });
      const res = makeMockRes();

      await unassignVehicleFromRoute(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(prisma.vehicleRoute.delete).toHaveBeenCalledWith({ where: { vehicleId_routeId: { vehicleId: "vehicle-1", routeId: "route-1" } } });
    });

    it("returns 404 when the vehicle does not exist", async () => {
      (prisma.vehicle.findUnique as jest.Mock).mockResolvedValue(null);
      const req = makeReq({ params: { vehicleId: "vehicle-1", routeId: "route-1" } });
      const res = makeMockRes();

      await unassignVehicleFromRoute(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(prisma.vehicleRoute.delete).not.toHaveBeenCalled();
    });

    it("SECURITY: rejects unassigning a vehicle from a different branch", async () => {
      (prisma.vehicle.findUnique as jest.Mock).mockResolvedValue({ id: "vehicle-1", branchId: "branch-OTHER" });
      const req = makeReq({ params: { vehicleId: "vehicle-1", routeId: "route-1" } });
      const res = makeMockRes();

      await unassignVehicleFromRoute(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(prisma.vehicleRoute.delete).not.toHaveBeenCalled();
    });

    it("returns 404 when the assignment does not exist", async () => {
      (prisma.vehicle.findUnique as jest.Mock).mockResolvedValue({ id: "vehicle-1", branchId: "branch-1" });
      (prisma.vehicleRoute.findUnique as jest.Mock).mockResolvedValue(null);
      const req = makeReq({ params: { vehicleId: "vehicle-1", routeId: "route-1" } });
      const res = makeMockRes();

      await unassignVehicleFromRoute(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(prisma.vehicleRoute.delete).not.toHaveBeenCalled();
    });
  });
});
