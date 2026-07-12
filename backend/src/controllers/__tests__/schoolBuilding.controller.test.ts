import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    schoolBuilding: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), delete: jest.fn() },
    schoolFloor: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    schoolRoom: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), delete: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    staff: { findUnique: jest.fn(), findMany: jest.fn() },
    section: { count: jest.fn() },
    roomCabin: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), delete: jest.fn() },
    $transaction: jest.fn(),
  },
}));

import prisma from "../../config/database";
import {
  createSchoolBuilding,
  getSchoolBuildings,
  addSchoolFloor,
  addSchoolRoom,
  updateSchoolRoom,
  deleteSchoolRoom,
  deleteSchoolBuilding,
  getSchoolOccupancySummary,
  bulkAddSchoolFloors,
  bulkAddSchoolRooms,
  addRoomCabin,
  getRoomCabins,
  updateRoomCabin,
  deleteRoomCabin,
} from "../schoolBuilding.controller";
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

describe("schoolBuilding.controller - createSchoolBuilding", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.schoolBuilding.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "building-1", ...data }));
  });

  it("falls back to the caller's own branch when the client sends an empty branchId", async () => {
    const req = makeReq({ body: { branchId: "", name: "Main Academic Block" } });
    const res = makeMockRes();

    await createSchoolBuilding(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect((prisma.schoolBuilding.create as jest.Mock).mock.calls[0][0].data.branchId).toBe("branch-1");
  });

  it("returns 400 when no branchId can be resolved", async () => {
    const req = makeReq({
      body: { branchId: "", name: "Main Academic Block" },
      user: { userId: "u1", email: "e", role: UserRole.ACCOUNTANT, branchId: undefined },
    });
    const res = makeMockRes();

    await createSchoolBuilding(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.schoolBuilding.create).not.toHaveBeenCalled();
  });

  it("SECURITY: silently neutralizes a Branch Admin trying to target a different branch", async () => {
    const req = makeReq({ body: { branchId: "branch-OTHER", name: "Main Academic Block" } });
    const res = makeMockRes();

    await createSchoolBuilding(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect((prisma.schoolBuilding.create as jest.Mock).mock.calls[0][0].data.branchId).toBe("branch-1");
  });
});

describe("schoolBuilding.controller - addSchoolFloor (SECURITY: branch-access)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 404 when the building does not exist", async () => {
    (prisma.schoolBuilding.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ body: { buildingId: "b1", floorNo: 1 } });
    const res = makeMockRes();

    await addSchoolFloor(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.schoolFloor.create).not.toHaveBeenCalled();
  });

  it("SECURITY: rejects adding a floor to a building in a DIFFERENT branch", async () => {
    (prisma.schoolBuilding.findUnique as jest.Mock).mockResolvedValue({ id: "b1", branchId: "branch-OTHER" });
    const req = makeReq({ body: { buildingId: "b1", floorNo: 1 } });
    const res = makeMockRes();

    await addSchoolFloor(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.schoolFloor.create).not.toHaveBeenCalled();
  });

  it("adds a floor to a building in the caller's own branch", async () => {
    (prisma.schoolBuilding.findUnique as jest.Mock).mockResolvedValue({ id: "b1", branchId: "branch-1" });
    (prisma.schoolFloor.create as jest.Mock).mockResolvedValue({ id: "floor-1", buildingId: "b1", floorNo: 1 });
    const req = makeReq({ body: { buildingId: "b1", floorNo: 1, name: "Ground Floor" } });
    const res = makeMockRes();

    await addSchoolFloor(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe("schoolBuilding.controller - addSchoolRoom (SECURITY: branch-access + staff cross-check)", () => {
  const FLOOR = { id: "floor-1", building: { id: "b1", branchId: "branch-1" } };
  const roomPayload = { floorId: "floor-1", roomNo: "204", type: "CLASSROOM", capacity: 40 };

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.schoolFloor.findUnique as jest.Mock).mockResolvedValue(FLOOR);
    (prisma.schoolRoom.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "room-1", ...data }));
  });

  it("returns 404 when the floor does not exist", async () => {
    (prisma.schoolFloor.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ body: roomPayload });
    const res = makeMockRes();

    await addSchoolRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.schoolRoom.create).not.toHaveBeenCalled();
  });

  it("SECURITY: rejects adding a room to a floor whose building is in a DIFFERENT branch", async () => {
    (prisma.schoolFloor.findUnique as jest.Mock).mockResolvedValue({ id: "floor-1", building: { id: "b1", branchId: "branch-OTHER" } });
    const req = makeReq({ body: roomPayload });
    const res = makeMockRes();

    await addSchoolRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.schoolRoom.create).not.toHaveBeenCalled();
  });

  it("creates a CLASSROOM room with no assignedStaffId (the common case)", async () => {
    const req = makeReq({ body: roomPayload });
    const res = makeMockRes();

    await addSchoolRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(prisma.staff.findUnique).not.toHaveBeenCalled();
  });

  it("DATA INTEGRITY: rejects assigning a CHAMBER to a staff member in a DIFFERENT branch", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: "staff-1", branchId: "branch-OTHER" });
    const req = makeReq({ body: { floorId: "floor-1", roomNo: "P-1", type: "CHAMBER", assignedStaffId: "staff-1" } });
    const res = makeMockRes();

    await addSchoolRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.schoolRoom.create).not.toHaveBeenCalled();
  });

  it("allows assigning a CHAMBER to a staff member in the SAME branch", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: "staff-1", branchId: "branch-1" });
    const req = makeReq({ body: { floorId: "floor-1", roomNo: "P-1", type: "CHAMBER", assignedStaffId: "staff-1" } });
    const res = makeMockRes();

    await addSchoolRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("defaults capacity to 0 when not provided", async () => {
    const req = makeReq({ body: { floorId: "floor-1", roomNo: "T-1", type: "TOILET" } });
    const res = makeMockRes();

    await addSchoolRoom(req, res);

    expect((prisma.schoolRoom.create as jest.Mock).mock.calls[0][0].data.capacity).toBe(0);
  });
});

describe("schoolBuilding.controller - updateSchoolRoom", () => {
  const ROOM = { id: "room-1", floor: { building: { id: "b1", branchId: "branch-1" } } };

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.schoolRoom.findUnique as jest.Mock).mockResolvedValue(ROOM);
    (prisma.schoolRoom.update as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "room-1", ...data }));
  });

  it("returns 404 when the room does not exist", async () => {
    (prisma.schoolRoom.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { id: "room-1" }, body: { roomNo: "205" } });
    const res = makeMockRes();

    await updateSchoolRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects updating a room in a DIFFERENT branch", async () => {
    (prisma.schoolRoom.findUnique as jest.Mock).mockResolvedValue({ id: "room-1", floor: { building: { id: "b1", branchId: "branch-OTHER" } } });
    const req = makeReq({ params: { id: "room-1" }, body: { roomNo: "205" } });
    const res = makeMockRes();

    await updateSchoolRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("updates only the provided fields", async () => {
    const req = makeReq({ params: { id: "room-1" }, body: { capacity: 45 } });
    const res = makeMockRes();

    await updateSchoolRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect((prisma.schoolRoom.update as jest.Mock).mock.calls[0][0].data).toEqual({ capacity: 45 });
  });
});

describe("schoolBuilding.controller - deleteSchoolRoom", () => {
  const ROOM = { id: "room-1", floor: { building: { id: "b1", branchId: "branch-1" } } };

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.schoolRoom.findUnique as jest.Mock).mockResolvedValue(ROOM);
  });

  it("returns 404 when the room does not exist", async () => {
    (prisma.schoolRoom.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { id: "room-1" } });
    const res = makeMockRes();

    await deleteSchoolRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("DATA INTEGRITY: blocks deletion when a section is currently linked to this room", async () => {
    (prisma.section.count as jest.Mock).mockResolvedValue(1);
    const req = makeReq({ params: { id: "room-1" } });
    const res = makeMockRes();

    await deleteSchoolRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.schoolRoom.delete).not.toHaveBeenCalled();
  });

  it("deletes the room when no section is linked to it", async () => {
    (prisma.section.count as jest.Mock).mockResolvedValue(0);
    const req = makeReq({ params: { id: "room-1" } });
    const res = makeMockRes();

    await deleteSchoolRoom(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.schoolRoom.delete).toHaveBeenCalledWith({ where: { id: "room-1" } });
  });
});

describe("schoolBuilding.controller - deleteSchoolBuilding", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.schoolBuilding.findUnique as jest.Mock).mockResolvedValue({ id: "b1", branchId: "branch-1" });
    (prisma.$transaction as jest.Mock).mockImplementation((fn: any) => fn(prisma));
    (prisma.schoolFloor.findMany as jest.Mock).mockResolvedValue([]);
  });

  it("returns 404 when the building does not exist", async () => {
    (prisma.schoolBuilding.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { id: "b1" } });
    const res = makeMockRes();

    await deleteSchoolBuilding(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("DATA INTEGRITY: blocks deletion when any section is linked to a room in this building", async () => {
    (prisma.section.count as jest.Mock).mockResolvedValue(3);
    const req = makeReq({ params: { id: "b1" } });
    const res = makeMockRes();

    await deleteSchoolBuilding(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("deletes the building (and cascades floors/rooms) when nothing is linked", async () => {
    (prisma.section.count as jest.Mock).mockResolvedValue(0);
    const req = makeReq({ params: { id: "b1" } });
    const res = makeMockRes();

    await deleteSchoolBuilding(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe("schoolBuilding.controller - getSchoolOccupancySummary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("computes room-type breakdown and classroom vacant/occupied from live student counts", async () => {
    (prisma.schoolRoom.findMany as jest.Mock).mockResolvedValue([
      {
        id: "room-1", roomNo: "101", type: "CLASSROOM", capacity: 40,
        floor: { building: { id: "b1", name: "Main Block" } },
        sections: [{ name: "A", class: { name: "Class 5" }, _count: { students: 35 } }],
      },
      {
        id: "room-2", roomNo: "Lab-1", type: "LAB", capacity: 30,
        floor: { building: { id: "b1", name: "Main Block" } },
        sections: [],
      },
    ]);
    const req = makeReq({ query: {} });
    const res = makeMockRes();

    await getSchoolOccupancySummary(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(payload.totalRooms).toBe(2);
    expect(payload.roomTypeBreakdown).toEqual({ CLASSROOM: 1, LAB: 1 });
    expect(payload.classrooms.totalCapacity).toBe(40);
    expect(payload.classrooms.totalOccupied).toBe(35);
    expect(payload.classrooms.totalVacant).toBe(5);
    expect(payload.classrooms.detail[0]).toEqual(
      expect.objectContaining({ roomId: "room-1", occupied: 35, vacant: 5, sections: ["Class 5 - A"] })
    );
  });

  it("returns zero totals with no error when the branch has no rooms at all", async () => {
    (prisma.schoolRoom.findMany as jest.Mock).mockResolvedValue([]);
    const req = makeReq({ query: {} });
    const res = makeMockRes();

    await getSchoolOccupancySummary(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(payload.totalRooms).toBe(0);
    expect(payload.classrooms.totalCapacity).toBe(0);
  });
});

describe("schoolBuilding.controller - getSchoolBuildings", () => {
  it("fetches buildings scoped to the caller's branch", async () => {
    (prisma.schoolBuilding.findMany as jest.Mock).mockResolvedValue([]);
    const req = makeReq({});
    const res = makeMockRes();

    await getSchoolBuildings(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect((prisma.schoolBuilding.findMany as jest.Mock).mock.calls[0][0].where).toEqual({ branchId: "branch-1" });
  });
});


// New Features Phase 5: bulk floor/room creation + multi-cabin
// chambers (RoomCabin).

describe("schoolBuilding.controller - bulkAddSchoolFloors", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.schoolBuilding.findUnique as jest.Mock).mockResolvedValue({ id: "building-1", branchId: "branch-1" });
    (prisma.schoolFloor.createMany as jest.Mock).mockResolvedValue({ count: 4 });
    (prisma.schoolFloor.findMany as jest.Mock).mockResolvedValue([
      { id: "f1", floorNo: 0 }, { id: "f2", floorNo: 1 }, { id: "f3", floorNo: 2 }, { id: "f4", floorNo: 3 },
    ]);
  });

  it("returns 404 when the building does not exist", async () => {
    (prisma.schoolBuilding.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ body: { buildingId: "building-1", count: 4 } });
    const res = makeMockRes();

    await bulkAddSchoolFloors(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects a building belonging to a DIFFERENT branch", async () => {
    (prisma.schoolBuilding.findUnique as jest.Mock).mockResolvedValue({ id: "building-1", branchId: "branch-OTHER" });
    const req = makeReq({ body: { buildingId: "building-1", count: 4 } });
    const res = makeMockRes();

    await bulkAddSchoolFloors(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.schoolFloor.createMany).not.toHaveBeenCalled();
  });

  it("creates N sequential floors starting from 0 by default", async () => {
    const req = makeReq({ body: { buildingId: "building-1", count: 4 } });
    const res = makeMockRes();

    await bulkAddSchoolFloors(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const data = (prisma.schoolFloor.createMany as jest.Mock).mock.calls[0][0].data;
    expect(data.map((f: any) => f.floorNo)).toEqual([0, 1, 2, 3]);
  });

  it("honors a custom startingFloorNo and namePrefix", async () => {
    const req = makeReq({ body: { buildingId: "building-1", count: 2, startingFloorNo: 1, namePrefix: "Wing A" } });
    const res = makeMockRes();

    await bulkAddSchoolFloors(req, res);

    const data = (prisma.schoolFloor.createMany as jest.Mock).mock.calls[0][0].data;
    expect(data).toEqual([
      { buildingId: "building-1", floorNo: 1, name: "Wing A Floor 1" },
      { buildingId: "building-1", floorNo: 2, name: "Wing A Floor 2" },
    ]);
  });
});

describe("schoolBuilding.controller - bulkAddSchoolRooms", () => {
  const FLOOR = { id: "floor-1", building: { id: "building-1", branchId: "branch-1" } };
  const ROOMS_INPUT = [
    { roomNo: "101", type: "CLASSROOM", capacity: 40 },
    { roomNo: "102", type: "CLASSROOM", capacity: 40 },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.schoolFloor.findUnique as jest.Mock).mockResolvedValue(FLOOR);
    (prisma.schoolRoom.createMany as jest.Mock).mockResolvedValue({ count: 2 });
    (prisma.schoolRoom.findMany as jest.Mock).mockResolvedValue([{ id: "r1", roomNo: "101" }, { id: "r2", roomNo: "102" }]);
  });

  it("returns 404 when the floor does not exist", async () => {
    (prisma.schoolFloor.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ body: { floorId: "floor-1", rooms: ROOMS_INPUT } });
    const res = makeMockRes();

    await bulkAddSchoolRooms(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects a floor belonging to a DIFFERENT branch", async () => {
    (prisma.schoolFloor.findUnique as jest.Mock).mockResolvedValue({ id: "floor-1", building: { branchId: "branch-OTHER" } });
    const req = makeReq({ body: { floorId: "floor-1", rooms: ROOMS_INPUT } });
    const res = makeMockRes();

    await bulkAddSchoolRooms(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.schoolRoom.createMany).not.toHaveBeenCalled();
  });

  it("creates every room in the list in one call", async () => {
    const req = makeReq({ body: { floorId: "floor-1", rooms: ROOMS_INPUT } });
    const res = makeMockRes();

    await bulkAddSchoolRooms(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(prisma.schoolRoom.createMany).toHaveBeenCalledTimes(1);
    expect((prisma.schoolRoom.createMany as jest.Mock).mock.calls[0][0].data).toHaveLength(2);
  });

  it("SECURITY: rejects the WHOLE batch when any assignedStaffId belongs to a DIFFERENT branch", async () => {
    (prisma.staff.findMany as jest.Mock).mockResolvedValue([{ id: "staff-1", branchId: "branch-OTHER" }]);
    const req = makeReq({
      body: { floorId: "floor-1", rooms: [{ roomNo: "201", type: "CHAMBER", assignedStaffId: "staff-1" }] },
    });
    const res = makeMockRes();

    await bulkAddSchoolRooms(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.schoolRoom.createMany).not.toHaveBeenCalled();
  });

  it("allows a valid assignedStaffId in the same branch", async () => {
    (prisma.staff.findMany as jest.Mock).mockResolvedValue([{ id: "staff-1", branchId: "branch-1" }]);
    const req = makeReq({
      body: { floorId: "floor-1", rooms: [{ roomNo: "201", type: "CHAMBER", assignedStaffId: "staff-1" }] },
    });
    const res = makeMockRes();

    await bulkAddSchoolRooms(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe("schoolBuilding.controller - addRoomCabin", () => {
  const ROOM = { id: "room-1", floor: { building: { branchId: "branch-1" } } };

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.schoolRoom.findUnique as jest.Mock).mockResolvedValue(ROOM);
    (prisma.roomCabin.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "cabin-1", ...data }));
  });

  it("returns 404 when the room does not exist", async () => {
    (prisma.schoolRoom.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ body: { roomId: "room-1", cabinNo: "C1" } });
    const res = makeMockRes();

    await addRoomCabin(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects a room belonging to a DIFFERENT branch", async () => {
    (prisma.schoolRoom.findUnique as jest.Mock).mockResolvedValue({ id: "room-1", floor: { building: { branchId: "branch-OTHER" } } });
    const req = makeReq({ body: { roomId: "room-1", cabinNo: "C1" } });
    const res = makeMockRes();

    await addRoomCabin(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects a staffId belonging to a DIFFERENT branch", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: "staff-1", branchId: "branch-OTHER" });
    const req = makeReq({ body: { roomId: "room-1", cabinNo: "C1", staffId: "staff-1" } });
    const res = makeMockRes();

    await addRoomCabin(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.roomCabin.create).not.toHaveBeenCalled();
  });

  it("creates a vacant cabin (no staffId) successfully", async () => {
    const req = makeReq({ body: { roomId: "room-1", cabinNo: "C1" } });
    const res = makeMockRes();

    await addRoomCabin(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(prisma.roomCabin.create).toHaveBeenCalledWith({ data: { roomId: "room-1", cabinNo: "C1", staffId: null } });
  });

  it("creates a cabin assigned to a valid same-branch staff member", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: "staff-1", branchId: "branch-1" });
    const req = makeReq({ body: { roomId: "room-1", cabinNo: "C2", staffId: "staff-1" } });
    const res = makeMockRes();

    await addRoomCabin(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe("schoolBuilding.controller - getRoomCabins", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.schoolRoom.findUnique as jest.Mock).mockResolvedValue({ id: "room-1", floor: { building: { branchId: "branch-1" } } });
    (prisma.roomCabin.findMany as jest.Mock).mockResolvedValue([]);
  });

  it("returns 404 when the room does not exist", async () => {
    (prisma.schoolRoom.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { roomId: "room-1" } });
    const res = makeMockRes();

    await getRoomCabins(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns the room's cabins ordered by cabinNo", async () => {
    const req = makeReq({ params: { roomId: "room-1" } });
    const res = makeMockRes();

    await getRoomCabins(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect((prisma.roomCabin.findMany as jest.Mock).mock.calls[0][0].orderBy).toEqual({ cabinNo: "asc" });
  });
});

describe("schoolBuilding.controller - updateRoomCabin", () => {
  const CABIN = { id: "cabin-1", room: { floor: { building: { branchId: "branch-1" } } } };

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.roomCabin.findUnique as jest.Mock).mockResolvedValue(CABIN);
    (prisma.roomCabin.update as jest.Mock).mockResolvedValue({ id: "cabin-1" });
  });

  it("returns 404 when the cabin does not exist", async () => {
    (prisma.roomCabin.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { id: "cabin-1" }, body: {} });
    const res = makeMockRes();

    await updateRoomCabin(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects a cabin whose room belongs to a DIFFERENT branch", async () => {
    (prisma.roomCabin.findUnique as jest.Mock).mockResolvedValue({ id: "cabin-1", room: { floor: { building: { branchId: "branch-OTHER" } } } });
    const req = makeReq({ params: { id: "cabin-1" }, body: {} });
    const res = makeMockRes();

    await updateRoomCabin(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects reassigning to a staffId in a DIFFERENT branch", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: "staff-1", branchId: "branch-OTHER" });
    const req = makeReq({ params: { id: "cabin-1" }, body: { staffId: "staff-1" } });
    const res = makeMockRes();

    await updateRoomCabin(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.roomCabin.update).not.toHaveBeenCalled();
  });

  it("allows unassigning a cabin (staffId: null)", async () => {
    const req = makeReq({ params: { id: "cabin-1" }, body: { staffId: null } });
    const res = makeMockRes();

    await updateRoomCabin(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.roomCabin.update).toHaveBeenCalledWith({ where: { id: "cabin-1" }, data: { staffId: null } });
  });
});

describe("schoolBuilding.controller - deleteRoomCabin", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.roomCabin.findUnique as jest.Mock).mockResolvedValue({ id: "cabin-1", room: { floor: { building: { branchId: "branch-1" } } } });
  });

  it("returns 404 when the cabin does not exist", async () => {
    (prisma.roomCabin.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { id: "cabin-1" } });
    const res = makeMockRes();

    await deleteRoomCabin(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("deletes the cabin when found and accessible", async () => {
    const req = makeReq({ params: { id: "cabin-1" } });
    const res = makeMockRes();

    await deleteRoomCabin(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.roomCabin.delete).toHaveBeenCalledWith({ where: { id: "cabin-1" } });
  });
});
