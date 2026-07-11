import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    hostelBuilding: { create: jest.fn(), findUnique: jest.fn() },
    hostelFloor: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
    hostelRoom: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    hostelAllocation: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), upsert: jest.fn() },
    student: { findUnique: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

import prisma from "../../config/database";
import { createBuilding, addFloor, addRoom, allocateRoom, bulkAllocateRoom, deallocateRoom } from "../hostel.controller";
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
    // No pre-existing allocation for this student by default (fresh allocation case).
    (prisma.hostelAllocation.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.hostelAllocation.upsert as jest.Mock).mockImplementation(({ create }: any) => Promise.resolve({ id: "alloc-1", ...create }));
    (prisma.hostelRoom.update as jest.Mock).mockResolvedValue({});
  });

  it("returns 404 when the room does not exist", async () => {
    (prisma.hostelRoom.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ body: { studentId: "student-1", roomId: "room-1" } });
    const res = makeMockRes();

    await allocateRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.hostelAllocation.upsert).not.toHaveBeenCalled();
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
    expect(prisma.hostelAllocation.upsert).not.toHaveBeenCalled();
  });

  it("returns 404 when the student does not exist", async () => {
    (prisma.student.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ body: { studentId: "student-1", roomId: "room-1" } });
    const res = makeMockRes();

    await allocateRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.hostelAllocation.upsert).not.toHaveBeenCalled();
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
    expect(prisma.hostelAllocation.upsert).not.toHaveBeenCalled();
  });

  it("rejects when the room is already full", async () => {
    (prisma.hostelRoom.findUnique as jest.Mock).mockResolvedValue({ ...ROOM, occupied: 2, capacity: 2 });
    const req = makeReq({ body: { studentId: "student-1", roomId: "room-1" } });
    const res = makeMockRes();

    await allocateRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.hostelAllocation.upsert).not.toHaveBeenCalled();
  });

  it("BUG FIX: rejects re-allocating a student who already has an ACTIVE allocation (must deallocate first)", async () => {
    (prisma.hostelAllocation.findUnique as jest.Mock).mockResolvedValue({ id: "alloc-old", roomId: "room-old", endDate: null });
    const req = makeReq({ body: { studentId: "student-1", roomId: "room-1" } });
    const res = makeMockRes();

    await allocateRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.hostelAllocation.upsert).not.toHaveBeenCalled();
  });

  it("BUG FIX: allows re-allocating a student whose PAST allocation has already ended (upsert, not a plain create that would hit the @unique constraint)", async () => {
    (prisma.hostelAllocation.findUnique as jest.Mock).mockResolvedValue({ id: "alloc-old", roomId: "room-old", endDate: new Date("2020-01-01") });
    const req = makeReq({ body: { studentId: "student-1", roomId: "room-1", bedNo: "A1" } });
    const res = makeMockRes();

    await allocateRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(prisma.hostelAllocation.upsert).toHaveBeenCalledWith({
      where: { studentId: "student-1" },
      update: expect.objectContaining({ roomId: "room-1", bedNo: "A1", endDate: null }),
      create: expect.objectContaining({ studentId: "student-1", roomId: "room-1", bedNo: "A1" }),
    });
  });

  it("allocates the student (fresh, no prior allocation) and increments the room's occupied count", async () => {
    const req = makeReq({ body: { studentId: "student-1", roomId: "room-1", bedNo: "A1" } });
    const res = makeMockRes();

    await allocateRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(prisma.hostelAllocation.upsert).toHaveBeenCalledWith({
      where: { studentId: "student-1" },
      update: expect.objectContaining({ roomId: "room-1", bedNo: "A1" }),
      create: expect.objectContaining({ studentId: "student-1", roomId: "room-1", bedNo: "A1" }),
    });
    expect(prisma.hostelRoom.update).toHaveBeenCalledWith({ where: { id: "room-1" }, data: { occupied: { increment: 1 } } });
  });
});

describe("hostel.controller - bulkAllocateRoom", () => {
  const BUILDING = { id: "building-1", branchId: "branch-1" };
  const ROOMS = [
    { id: "room-101", roomNo: "101", capacity: 2, occupied: 0, floor: { floorNo: 1 } },
    { id: "room-102", roomNo: "102", capacity: 1, occupied: 0, floor: { floorNo: 1 } },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.hostelBuilding.findUnique as jest.Mock).mockResolvedValue(BUILDING);
    (prisma.hostelFloor.findUnique as jest.Mock).mockResolvedValue({ id: "floor-1", buildingId: "building-1" });
    (prisma.hostelRoom.findMany as jest.Mock).mockResolvedValue(ROOMS.map((r) => ({ ...r })));
    (prisma.student.findMany as jest.Mock).mockResolvedValue([
      { id: "s1", branchId: "branch-1" },
      { id: "s2", branchId: "branch-1" },
      { id: "s3", branchId: "branch-1" },
    ]);
    (prisma.hostelAllocation.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.$transaction as jest.Mock).mockResolvedValue([]);
  });

  it("returns 404 when the building does not exist", async () => {
    (prisma.hostelBuilding.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ body: { buildingId: "building-1", studentIds: ["s1"] } });
    const res = makeMockRes();

    await bulkAllocateRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("SECURITY: rejects when the building belongs to a DIFFERENT branch", async () => {
    (prisma.hostelBuilding.findUnique as jest.Mock).mockResolvedValue({ id: "building-1", branchId: "branch-OTHER" });
    const req = makeReq({ body: { buildingId: "building-1", studentIds: ["s1"] } });
    const res = makeMockRes();

    await bulkAllocateRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns 404 when a floorId is given that doesn't belong to the building", async () => {
    (prisma.hostelFloor.findUnique as jest.Mock).mockResolvedValue({ id: "floor-1", buildingId: "building-OTHER" });
    const req = makeReq({ body: { buildingId: "building-1", floorId: "floor-1", studentIds: ["s1"] } });
    const res = makeMockRes();

    await bulkAllocateRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 404 when one or more studentIds don't exist", async () => {
    (prisma.student.findMany as jest.Mock).mockResolvedValue([{ id: "s1", branchId: "branch-1" }]);
    const req = makeReq({ body: { buildingId: "building-1", studentIds: ["s1", "s-missing"] } });
    const res = makeMockRes();

    await bulkAllocateRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects (IDOR) when a student belongs to a DIFFERENT branch than the building", async () => {
    (prisma.student.findMany as jest.Mock).mockResolvedValue([{ id: "s1", branchId: "branch-OTHER" }]);
    const req = makeReq({ body: { buildingId: "building-1", studentIds: ["s1"] } });
    const res = makeMockRes();

    await bulkAllocateRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("fills rooms in floor/room order, spreading students across multiple rooms once one fills up", async () => {
    const req = makeReq({ body: { buildingId: "building-1", studentIds: ["s1", "s2", "s3"] } });
    const res = makeMockRes();

    await bulkAllocateRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const responseData = res.json.mock.calls[0][0].data;
    // room-101 (capacity 2) takes s1+s2, room-102 (capacity 1) takes s3.
    expect(responseData.allocated).toEqual([
      { studentId: "s1", roomId: "room-101", roomNo: "101" },
      { studentId: "s2", roomId: "room-101", roomNo: "101" },
      { studentId: "s3", roomId: "room-102", roomNo: "102" },
    ]);
    expect(responseData.skipped).toEqual([]);
  });

  it("skips a student with no remaining room capacity in scope", async () => {
    (prisma.hostelRoom.findMany as jest.Mock).mockResolvedValue([{ ...ROOMS[0], capacity: 1 }]);
    const req = makeReq({ body: { buildingId: "building-1", studentIds: ["s1", "s2"] } });
    const res = makeMockRes();

    await bulkAllocateRoom(req, res);

    const responseData = res.json.mock.calls[0][0].data;
    expect(responseData.allocated).toEqual([{ studentId: "s1", roomId: "room-101", roomNo: "101" }]);
    expect(responseData.skipped).toEqual([{ studentId: "s2", reason: "No available room capacity remaining in scope" }]);
  });

  it("skips a student who already has an active allocation, by default (reassignExisting not set)", async () => {
    (prisma.hostelAllocation.findMany as jest.Mock).mockResolvedValue([{ studentId: "s1", roomId: "room-old", endDate: null }]);
    const req = makeReq({ body: { buildingId: "building-1", studentIds: ["s1", "s2"] } });
    const res = makeMockRes();

    await bulkAllocateRoom(req, res);

    const responseData = res.json.mock.calls[0][0].data;
    expect(responseData.skipped).toEqual([{ studentId: "s1", reason: "Already has an active room allocation" }]);
    expect(responseData.allocated).toEqual([{ studentId: "s2", roomId: "room-101", roomNo: "101" }]);
  });

  it("with reassignExisting=true, moves an already-allocated student into a new room instead of skipping", async () => {
    (prisma.hostelAllocation.findMany as jest.Mock).mockResolvedValue([{ studentId: "s1", roomId: "room-old", endDate: null }]);
    const req = makeReq({ body: { buildingId: "building-1", studentIds: ["s1"], reassignExisting: true } });
    const res = makeMockRes();

    await bulkAllocateRoom(req, res);

    const responseData = res.json.mock.calls[0][0].data;
    expect(responseData.allocated).toEqual([{ studentId: "s1", roomId: "room-101", roomNo: "101" }]);
    expect(responseData.skipped).toEqual([]);
    expect(prisma.hostelAllocation.update).toHaveBeenCalledWith({
      where: { studentId: "s1" },
      data: expect.objectContaining({ roomId: "room-101", endDate: null }),
    });
  });

  it("returns a summary with zero allocated when studentIds is a valid but entirely-skipped batch, without ever calling $transaction with empty writes", async () => {
    (prisma.hostelRoom.findMany as jest.Mock).mockResolvedValue([]);
    const req = makeReq({ body: { buildingId: "building-1", studentIds: ["s1"] } });
    const res = makeMockRes();

    await bulkAllocateRoom(req, res);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    const responseData = res.json.mock.calls[0][0].data;
    expect(responseData.allocated).toEqual([]);
    expect(responseData.skipped).toEqual([{ studentId: "s1", reason: "No available room capacity remaining in scope" }]);
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
