import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    hostelBuilding: { create: jest.fn() },
    hostelFloor: { create: jest.fn(), findUnique: jest.fn() },
    hostelRoom: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    hostelAllocation: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    student: { findUnique: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { createBuilding, addFloor, addRoom, allocateRoom, deallocateRoom } from "../hostel.controller";
import { AuthRequest } from "../../types";

const makeMockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const makeReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
  ({
    body: { name: "Boys Hostel", type: "BOYS" },
    params: {},
    query: {},
    user: { userId: "admin-1", email: "admin@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" },
    ...overrides,
  } as any);

describe("hostel.controller - createBuilding", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.hostelBuilding.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "building-1", ...data }));
  });

  it("BUG FIX: falls back to the caller's own branch when the client sends an empty branchId", async () => {
    const req = makeReq({ body: { branchId: "", name: "Boys Hostel", type: "BOYS" } });
    const res = makeMockRes();

    await createBuilding(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect((prisma.hostelBuilding.create as jest.Mock).mock.calls[0][0].data.branchId).toBe("branch-1");
  });

  it("returns 400 when no branchId can be resolved", async () => {
    const req = makeReq({
      body: { branchId: "", name: "Boys Hostel" },
      user: { userId: "u1", email: "e", role: UserRole.ACCOUNTANT, branchId: undefined },
    });
    const res = makeMockRes();

    await createBuilding(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.hostelBuilding.create).not.toHaveBeenCalled();
  });

  it("SECURITY: silently neutralizes a Branch Admin trying to target a different branch (creates under their own branch instead)", async () => {
    const req = makeReq({ body: { branchId: "branch-OTHER", name: "Boys Hostel", type: "BOYS" } });
    const res = makeMockRes();

    await createBuilding(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect((prisma.hostelBuilding.create as jest.Mock).mock.calls[0][0].data.branchId).toBe("branch-1");
  });
});


describe("hostel.controller - addFloor (SECURITY: branch-access fix)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 404 when the building does not exist", async () => {
    (prisma.hostelFloor.findUnique as jest.Mock); // not used here
    (prisma as any).hostelBuilding.findUnique = jest.fn().mockResolvedValue(null);
    const req = makeReq({ body: { buildingId: "b1", floorNo: 1 } });
    const res = makeMockRes();

    await addFloor(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.hostelFloor.create).not.toHaveBeenCalled();
  });

  it("SECURITY: rejects adding a floor to a building in a DIFFERENT branch", async () => {
    (prisma as any).hostelBuilding.findUnique = jest.fn().mockResolvedValue({ id: "b1", branchId: "branch-OTHER" });
    const req = makeReq({ body: { buildingId: "b1", floorNo: 1 } });
    const res = makeMockRes();

    await addFloor(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.hostelFloor.create).not.toHaveBeenCalled();
  });

  it("allows adding a floor to a building in the caller's OWN branch", async () => {
    (prisma as any).hostelBuilding.findUnique = jest.fn().mockResolvedValue({ id: "b1", branchId: "branch-1" });
    (prisma.hostelFloor.create as jest.Mock).mockResolvedValue({ id: "floor-1", buildingId: "b1", floorNo: 1 });
    const req = makeReq({ body: { buildingId: "b1", floorNo: 1 } });
    const res = makeMockRes();

    await addFloor(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(prisma.hostelFloor.create).toHaveBeenCalledWith({ data: { buildingId: "b1", floorNo: 1 } });
  });
});

describe("hostel.controller - addRoom (SECURITY: branch-access fix)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const roomPayload = { floorId: "floor-1", roomNo: "101", type: "DOUBLE", capacity: 2, monthlyFee: 5000 };

  it("returns 404 when the floor does not exist", async () => {
    (prisma.hostelFloor.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ body: roomPayload });
    const res = makeMockRes();

    await addRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.hostelRoom.create).not.toHaveBeenCalled();
  });

  it("SECURITY: rejects adding a room to a floor whose building is in a DIFFERENT branch", async () => {
    (prisma.hostelFloor.findUnique as jest.Mock).mockResolvedValue({
      id: "floor-1",
      building: { id: "b1", branchId: "branch-OTHER" },
    });
    const req = makeReq({ body: roomPayload });
    const res = makeMockRes();

    await addRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.hostelRoom.create).not.toHaveBeenCalled();
  });

  it("allows adding a room when the floor's building is in the caller's own branch", async () => {
    (prisma.hostelFloor.findUnique as jest.Mock).mockResolvedValue({
      id: "floor-1",
      building: { id: "b1", branchId: "branch-1" },
    });
    (prisma.hostelRoom.create as jest.Mock).mockResolvedValue({ id: "room-1", ...roomPayload });
    const req = makeReq({ body: roomPayload });
    const res = makeMockRes();

    await addRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe("hostel.controller - allocateRoom (SECURITY: branch-access fix)", () => {
  const ROOM = { id: "room-1", occupied: 0, capacity: 2, floor: { building: { id: "b1", branchId: "branch-1" } } };
  const STUDENT = { id: "student-1", branchId: "branch-1" };

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.hostelRoom.findUnique as jest.Mock).mockResolvedValue(ROOM);
    (prisma.student.findUnique as jest.Mock).mockResolvedValue(STUDENT);
    (prisma.hostelAllocation.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "alloc-1", ...data }));
    (prisma.hostelRoom.update as jest.Mock).mockResolvedValue({});
  });

  it("returns 404 when the room does not exist", async () => {
    (prisma.hostelRoom.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ body: { studentId: "student-1", roomId: "room-1" } });
    const res = makeMockRes();

    await allocateRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.hostelAllocation.create).not.toHaveBeenCalled();
  });

  it("SECURITY: rejects allocating a room whose building is in a DIFFERENT branch", async () => {
    (prisma.hostelRoom.findUnique as jest.Mock).mockResolvedValue({
      ...ROOM,
      floor: { building: { id: "b1", branchId: "branch-OTHER" } },
    });
    const req = makeReq({ body: { studentId: "student-1", roomId: "room-1" } });
    const res = makeMockRes();

    await allocateRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.hostelAllocation.create).not.toHaveBeenCalled();
  });

  it("returns 404 when the student does not exist", async () => {
    (prisma.student.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ body: { studentId: "student-1", roomId: "room-1" } });
    const res = makeMockRes();

    await allocateRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.hostelAllocation.create).not.toHaveBeenCalled();
  });

  it("SECURITY: rejects when the student belongs to a DIFFERENT branch than the room (even if caller could access either individually)", async () => {
    (prisma.student.findUnique as jest.Mock).mockResolvedValue({ id: "student-1", branchId: "branch-OTHER" });
    const req = makeReq({
      body: { studentId: "student-1", roomId: "room-1" },
      user: { userId: "super-1", email: "e", role: UserRole.SUPER_ADMIN },
    });
    const res = makeMockRes();

    await allocateRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.hostelAllocation.create).not.toHaveBeenCalled();
  });

  it("rejects when the room is already full", async () => {
    (prisma.hostelRoom.findUnique as jest.Mock).mockResolvedValue({ ...ROOM, occupied: 2, capacity: 2 });
    const req = makeReq({ body: { studentId: "student-1", roomId: "room-1" } });
    const res = makeMockRes();

    await allocateRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.hostelAllocation.create).not.toHaveBeenCalled();
  });

  it("allocates the student and increments the room's occupied count", async () => {
    const req = makeReq({ body: { studentId: "student-1", roomId: "room-1", bedNo: "A1" } });
    const res = makeMockRes();

    await allocateRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(prisma.hostelAllocation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ studentId: "student-1", roomId: "room-1", bedNo: "A1" }),
    });
    expect(prisma.hostelRoom.update).toHaveBeenCalledWith({ where: { id: "room-1" }, data: { occupied: { increment: 1 } } });
  });
});

describe("hostel.controller - deallocateRoom (SECURITY: branch-access fix)", () => {
  const ALLOC = { id: "alloc-1", roomId: "room-1", room: { floor: { building: { id: "b1", branchId: "branch-1" } } } };

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.hostelAllocation.findUnique as jest.Mock).mockResolvedValue(ALLOC);
    (prisma.hostelAllocation.update as jest.Mock).mockResolvedValue({});
    (prisma.hostelRoom.update as jest.Mock).mockResolvedValue({});
  });

  it("returns 404 when the allocation does not exist", async () => {
    (prisma.hostelAllocation.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { id: "alloc-1" } });
    const res = makeMockRes();

    await deallocateRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.hostelAllocation.update).not.toHaveBeenCalled();
  });

  it("SECURITY: rejects deallocating a room whose building is in a DIFFERENT branch", async () => {
    (prisma.hostelAllocation.findUnique as jest.Mock).mockResolvedValue({
      ...ALLOC,
      room: { floor: { building: { id: "b1", branchId: "branch-OTHER" } } },
    });
    const req = makeReq({ params: { id: "alloc-1" } });
    const res = makeMockRes();

    await deallocateRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.hostelAllocation.update).not.toHaveBeenCalled();
  });

  it("deallocates and decrements the room's occupied count", async () => {
    const req = makeReq({ params: { id: "alloc-1" } });
    const res = makeMockRes();

    await deallocateRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.hostelAllocation.update).toHaveBeenCalledWith({ where: { id: "alloc-1" }, data: { endDate: expect.any(Date) } });
    expect(prisma.hostelRoom.update).toHaveBeenCalledWith({ where: { id: "room-1" }, data: { occupied: { decrement: 1 } } });
  });
});
