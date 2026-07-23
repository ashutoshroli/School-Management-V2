import { Response } from "express";
import { UserRole } from "@prisma/client";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { resolveBranchId, resolveEffectiveBranchId, canAccessBranch } from "../utils/branchScope";

export const createBuilding = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, type, warden } = req.body;
    // BUG FIX + SECURITY: the "Add Building" form has no branch-picker,
    // so req.body.branchId always arrived as "" - see
    // resolveEffectiveBranchId's doc comment. Also adds the
    // canAccessBranch check this endpoint was previously missing
    // entirely.
    const branchId = resolveEffectiveBranchId(req, req.body.branchId);

    if (!branchId) {
      sendError(res, "Branch ID could not be resolved - please select a branch", 400);
      return;
    }
    if (!canAccessBranch(req, branchId)) {
      sendError(res, "Access denied: branch mismatch", 403);
      return;
    }

    const building = await prisma.hostelBuilding.create({ data: { branchId, name, type, warden } });
    sendSuccess(res, building, "Building created", 201);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

export const getBuildings = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    const buildings = await prisma.hostelBuilding.findMany({
      where: { branchId },
      // Each room's CURRENT (endDate: null) allocations, with the
      // resident's name/admissionNo - needed by the frontend's "manage
      // room" flow (allocate/deallocate) so it can show who's currently
      // in a room without a second round trip to getOccupancy for the
      // exact same information.
      include: {
        floors: {
          include: {
            rooms: {
              include: {
                allocations: {
                  where: { endDate: null },
                  include: { student: { include: { user: { select: { name: true } } } } },
                },
              },
            },
          },
        },
      },
      orderBy: { name: "asc" },
    });
    sendSuccess(res, buildings, "Buildings fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * SECURITY: addFloor/addRoom/allocateRoom/deallocateRoom below all
 * previously had NO branch-access check at all - the same class of
 * IDOR bug already fixed elsewhere in this codebase (see
 * createClass/createSection's "SECURITY" comments, and
 * promotion.controller.ts's bulkPromote fix) - a Branch Admin could
 * pass any other branch's real buildingId/floorId/roomId and add
 * floors/rooms to, or allocate/deallocate students in, a hostel
 * building they have no access to. Fixed by resolving the referenced
 * building's OWN branchId from the DB (via its floor/room chain, since
 * that's the only place branchId is actually stored) and requiring
 * canAccessBranch for it.
 */

export const addFloor = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { buildingId, floorNo } = req.body;

    const building = await prisma.hostelBuilding.findUnique({ where: { id: buildingId } });
    if (!building) { sendError(res, "Building not found", 404); return; }
    if (!canAccessBranch(req, building.branchId)) { sendError(res, "Building not found", 404); return; }

    const floor = await prisma.hostelFloor.create({ data: { buildingId, floorNo } });
    sendSuccess(res, floor, "Floor added", 201);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

export const addRoom = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { floorId, roomNo, type, capacity, monthlyFee } = req.body;

    const floor = await prisma.hostelFloor.findUnique({ where: { id: floorId }, include: { building: true } });
    if (!floor) { sendError(res, "Floor not found", 404); return; }
    if (!canAccessBranch(req, floor.building.branchId)) { sendError(res, "Floor not found", 404); return; }

    const room = await prisma.hostelRoom.create({ data: { floorId, roomNo, type, capacity, monthlyFee } });
    sendSuccess(res, room, "Room added", 201);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

export const allocateRoom = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { studentId, roomId, bedNo } = req.body;

    const room = await prisma.hostelRoom.findUnique({ where: { id: roomId }, include: { floor: { include: { building: true } } } });
    if (!room) { sendError(res, "Room not found", 404); return; }
    if (!canAccessBranch(req, room.floor.building.branchId)) { sendError(res, "Room not found", 404); return; }

    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student) { sendError(res, "Student not found", 404); return; }
    // Cross-check the STUDENT's own branch too, not just the room's -
    // both must be within the caller's accessible branch, and (since a
    // student living in one branch's hostel building from a different
    // branch would itself be nonsensical data) the two must also agree
    // with each other.
    if (!canAccessBranch(req, student.branchId) || student.branchId !== room.floor.building.branchId) {
      sendError(res, "Student and room must belong to the same branch you can access", 403);
      return;
    }

    // BUG FIX: HostelAllocation.studentId is @unique (one CURRENT
    // room per student, mirroring TransportAllocation's exact same
    // shape) - the old code always did a plain `create`, which threw
    // an unhandled unique-constraint error (surfacing as a generic 500
    // "Failed") the moment anyone tried to re-allocate/move a student
    // who already had ANY allocation row (even a past, already-ended
    // one - the column has no filter on endDate). Mirrors
    // transport.controller.ts's allocateStudent, which already upserts
    // for this exact reason.
    const existing = await prisma.hostelAllocation.findUnique({ where: { studentId } });
    if (existing && !existing.endDate) {
      sendError(res, "This student already has an active room allocation - deallocate it first", 400);
      return;
    }

    if (room.occupied >= room.capacity) { sendError(res, "Room full", 400); return; }

    const alloc = await prisma.hostelAllocation.upsert({
      where: { studentId },
      update: { roomId, bedNo, startDate: new Date(), endDate: null },
      create: { studentId, roomId, bedNo, startDate: new Date() },
    });
    await prisma.hostelRoom.update({ where: { id: roomId }, data: { occupied: { increment: 1 } } });
    sendSuccess(res, alloc, "Room allocated", 201);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Bulk-allocate a list of students into whatever hostel rooms in
 * `buildingId` (optionally narrowed to a single `floorId`) currently
 * have free capacity, filling rooms in floor/room order - the hostel
 * counterpart to bulkAssignFees/bulkAssignSalaryStructure's "pick a
 * scope, apply to many students" pattern. Unlike those two, each
 * student here gets a DIFFERENT roomId (whichever has space when their
 * turn comes), so this can't be a single bulk createMany the way an
 * identical-data bulk write can - it's a loop, but the actual DB writes
 * for all of it happen inside one transaction for atomicity.
 *
 * Students who already have an ACTIVE allocation are skipped by
 * default (same "skip existing, don't silently move them" convention
 * as bulkAssignSalaryStructure) - pass `reassignExisting: true` to
 * instead deallocate their current room and place them into a new one
 * from this batch.
 *
 * Returns a per-student outcome list (allocated with room number, or
 * skipped with a reason) rather than just a count, since "which
 * student landed in which room" is exactly what a warden needs to see
 * after a bulk placement (unlike the salary/fee bulk endpoints, where
 * every target gets identical treatment and a summary count suffices).
 */
export const bulkAllocateRoom = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { buildingId, floorId, studentIds, reassignExisting } = req.body;

    const building = await prisma.hostelBuilding.findUnique({ where: { id: buildingId } });
    if (!building) { sendError(res, "Building not found", 404); return; }
    if (!canAccessBranch(req, building.branchId)) { sendError(res, "Building not found", 404); return; }

    if (floorId) {
      const floor = await prisma.hostelFloor.findUnique({ where: { id: floorId } });
      if (!floor || floor.buildingId !== buildingId) {
        sendError(res, "Floor not found in this building", 404);
        return;
      }
    }

    // Every room in scope, in a stable fill order (lowest floor first,
    // then room number) - "next available space" always means the
    // same physical room regardless of which student in the batch gets
    // to it first.
    const rooms = await prisma.hostelRoom.findMany({
      where: { floor: { buildingId, ...(floorId ? { id: floorId } : {}) } },
      include: { floor: true },
      orderBy: [{ floor: { floorNo: "asc" } }, { roomNo: "asc" }],
    });

    // Validate every requested student up front: must exist and belong
    // to the SAME branch as the building (IDOR guard, same pattern as
    // allocateRoom/assignSalaryStructureToStaff).
    const students = await prisma.student.findMany({
      where: { id: { in: studentIds } },
      select: { id: true, branchId: true },
    });
    const foundIds = new Set(students.map((s) => s.id));
    const notFound = (studentIds as string[]).filter((id) => !foundIds.has(id));
    if (notFound.length > 0) {
      sendError(res, `${notFound.length} student(s) in this list were not found`, 404);
      return;
    }
    const wrongBranch = students.some((s) => s.branchId !== building.branchId);
    if (wrongBranch) {
      sendError(res, "One or more students do not belong to this hostel building's branch", 403);
      return;
    }

    const existingAllocations = await prisma.hostelAllocation.findMany({
      where: { studentId: { in: studentIds }, endDate: null },
    });
    const existingByStudent = new Map(existingAllocations.map((a) => [a.studentId, a]));

    // Track remaining free capacity per room in memory as we assign,
    // so two students in the same batch never get double-booked into
    // the same last free bed.
    const freeCapacity = new Map(rooms.map((r) => [r.id, r.capacity - r.occupied]));

    const allocated: { studentId: string; roomId: string; roomNo: string }[] = [];
    const skipped: { studentId: string; reason: string }[] = [];
    const roomOccupiedDelta = new Map<string, number>();
    const writes: any[] = [];

    for (const studentId of studentIds as string[]) {
      const existing = existingByStudent.get(studentId);
      if (existing && !reassignExisting) {
        skipped.push({ studentId, reason: "Already has an active room allocation" });
        continue;
      }

      const room = rooms.find((r) => (freeCapacity.get(r.id) || 0) > 0);
      if (!room) {
        skipped.push({ studentId, reason: "No available room capacity remaining in scope" });
        continue;
      }

      freeCapacity.set(room.id, (freeCapacity.get(room.id) || 0) - 1);
      roomOccupiedDelta.set(room.id, (roomOccupiedDelta.get(room.id) || 0) + 1);

      if (existing) {
        // Freeing up their old room's capacity too, in case it's also
        // within this same scope (e.g. moving a student between floors
        // of the same building).
        roomOccupiedDelta.set(existing.roomId, (roomOccupiedDelta.get(existing.roomId) || 0) - 1);
        writes.push(
          prisma.hostelAllocation.update({
            where: { studentId },
            data: { roomId: room.id, bedNo: null, startDate: new Date(), endDate: null },
          })
        );
      } else {
        writes.push(prisma.hostelAllocation.create({ data: { studentId, roomId: room.id, startDate: new Date() } }));
      }
      allocated.push({ studentId, roomId: room.id, roomNo: room.roomNo });
    }

    for (const [roomId, delta] of roomOccupiedDelta) {
      if (delta !== 0) writes.push(prisma.hostelRoom.update({ where: { id: roomId }, data: { occupied: { increment: delta } } }));
    }

    if (writes.length > 0) await prisma.$transaction(writes);

    sendSuccess(
      res,
      { allocated, skipped, total: (studentIds as string[]).length },
      `${allocated.length} student(s) allocated, ${skipped.length} skipped`
    );
  } catch (error) {
    sendError(res, "Failed to bulk-allocate rooms", 500, (error as Error).message);
  }
};

/**
 * Creates N sequential floors on one hostel building in a single call,
 * same "set up a whole building at once" convenience as
 * bulkAddSchoolFloors (schoolBuilding.controller.ts) - auto-numbered
 * from an optional `startingFloorNo` (default 0). HostelFloor has no
 * `name` field (unlike SchoolFloor), so there's no name-prefix option
 * here - just sequential floor numbers.
 */
export const bulkAddFloors = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { buildingId, count, startingFloorNo } = req.body;

    const building = await prisma.hostelBuilding.findUnique({ where: { id: buildingId } });
    if (!building) { sendError(res, "Building not found", 404); return; }
    if (!canAccessBranch(req, building.branchId)) { sendError(res, "Building not found", 404); return; }

    const start = startingFloorNo ?? 0;
    const floors = Array.from({ length: count }, (_, i) => ({ buildingId, floorNo: start + i }));

    await prisma.hostelFloor.createMany({ data: floors });

    const created = await prisma.hostelFloor.findMany({
      where: { buildingId, floorNo: { in: floors.map((f) => f.floorNo) } },
      orderBy: { floorNo: "asc" },
    });
    sendSuccess(res, created, `${created.length} floor(s) added`, 201);
  } catch (error) { sendError(res, "Failed to add floors", 500, (error as Error).message); }
};

/**
 * Creates a whole list of rooms on one hostel floor in a single call,
 * same convenience as bulkAddSchoolRooms - one INSERT instead of one
 * addRoom call per room.
 */
export const bulkAddRooms = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { floorId, rooms } = req.body;

    const floor = await prisma.hostelFloor.findUnique({ where: { id: floorId }, include: { building: true } });
    if (!floor) { sendError(res, "Floor not found", 404); return; }
    if (!canAccessBranch(req, floor.building.branchId)) { sendError(res, "Floor not found", 404); return; }

    await prisma.hostelRoom.createMany({
      data: rooms.map((r: any) => ({
        floorId,
        roomNo: r.roomNo,
        type: r.type,
        capacity: r.capacity,
        monthlyFee: r.monthlyFee,
      })),
    });

    const created = await prisma.hostelRoom.findMany({
      where: { floorId, roomNo: { in: rooms.map((r: any) => r.roomNo) } },
      orderBy: { roomNo: "asc" },
    });
    sendSuccess(res, created, `${created.length} room(s) added`, 201);
  } catch (error) { sendError(res, "Failed to add rooms", 500, (error as Error).message); }
};

export const deallocateRoom = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const alloc = await prisma.hostelAllocation.findUnique({
      where: { id },
      include: { room: { include: { floor: { include: { building: true } } } } },
    });
    if (!alloc) { sendError(res, "Not found", 404); return; }
    if (!canAccessBranch(req, alloc.room.floor.building.branchId)) { sendError(res, "Not found", 404); return; }

    await prisma.hostelAllocation.update({ where: { id }, data: { endDate: new Date() } });
    await prisma.hostelRoom.update({ where: { id: alloc.roomId }, data: { occupied: { decrement: 1 } } });
    sendSuccess(res, null, "Room deallocated");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Delete a hostel building. Blocked if any room in any of its floors
 * currently has an active allocation (a student living there) -
 * deallocate first.
 */
export const deleteBuilding = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const building = await prisma.hostelBuilding.findUnique({ where: { id } });
    if (!building) { sendError(res, "Building not found", 404); return; }
    if (!canAccessBranch(req, building.branchId)) { sendError(res, "Building not found", 404); return; }

    const activeAllocationCount = await prisma.hostelAllocation.count({
      where: { endDate: null, room: { floor: { buildingId: id } } },
    });
    if (activeAllocationCount > 0) {
      sendError(res, `Cannot delete: ${activeAllocationCount} student(s) currently reside in this building. Deallocate them first.`, 400);
      return;
    }

    await prisma.$transaction(async (tx) => {
      const floors = await tx.hostelFloor.findMany({ where: { buildingId: id }, select: { id: true } });
      const floorIds = floors.map((f) => f.id);
      const rooms = await tx.hostelRoom.findMany({ where: { floorId: { in: floorIds } }, select: { id: true } });
      const roomIds = rooms.map((r) => r.id);

      await tx.hostelAllocation.deleteMany({ where: { roomId: { in: roomIds } } });
      await tx.hostelRoom.deleteMany({ where: { floorId: { in: floorIds } } });
      await tx.hostelFloor.deleteMany({ where: { buildingId: id } });
      await tx.hostelBuilding.delete({ where: { id } });
    });

    sendSuccess(res, null, "Building deleted");
  } catch (error) { sendError(res, "Failed to delete building", 500, (error as Error).message); }
};

export const getOccupancy = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    const buildings = await prisma.hostelBuilding.findMany({
      where: { branchId },
      include: { floors: { include: { rooms: { include: { allocations: { where: { endDate: null }, include: { student: { include: { user: { select: { name: true } } } } } } } } } } },
    });
    sendSuccess(res, buildings, "Occupancy fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Student self-service bed request (spec Section 13): the request flow
 * differs based on the target room's current state.
 *  - EMPTY room -> auto-allotted immediately, but PROVISIONAL until
 *    the room's allotmentCutoffDate passes and the Warden finalizes it
 *    (see finalizeHostelAllotments below).
 *  - OCCUPIED room -> goes to the existing roommate first via a
 *    HostelRoomRequest; only auto-allotted if/when they approve (see
 *    respondToRoomRequest below).
 */
export const requestBed = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { studentId, roomId } = req.body;

    const room = await prisma.hostelRoom.findUnique({ where: { id: roomId }, include: { floor: { include: { building: true } }, allocations: { where: { endDate: null } } } });
    if (!room) { sendError(res, "Room not found", 404); return; }
    if (!canAccessBranch(req, room.floor.building.branchId)) { sendError(res, "Room not found", 404); return; }

    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student || student.branchId !== room.floor.building.branchId) {
      sendError(res, "Student not found in this branch", 404);
      return;
    }

    const existingAllocation = await prisma.hostelAllocation.findUnique({ where: { studentId } });
    if (existingAllocation && !existingAllocation.endDate) {
      sendError(res, "This student already has an active room allocation", 400);
      return;
    }

    if (room.occupied >= room.capacity) {
      sendError(res, "Room is already full", 400);
      return;
    }

    if (room.occupied === 0) {
      // Empty room: auto-allot, provisional until the Warden's cutoff
      // date has been set and passed / Warden finalizes.
      const alloc = await prisma.hostelAllocation.upsert({
        where: { studentId },
        update: { roomId, startDate: new Date(), endDate: null, isProvisional: true },
        create: { studentId, roomId, startDate: new Date(), isProvisional: true },
      });
      await prisma.hostelRoom.update({ where: { id: roomId }, data: { occupied: { increment: 1 } } });
      sendSuccess(res, alloc, "Room auto-allotted (provisional until Warden finalizes)", 201);
      return;
    }

    // Occupied room: ask the existing roommate first.
    const existingRoommateId = room.allocations[0].studentId;
    const request = await prisma.hostelRoomRequest.create({
      data: { studentId, roomId, existingRoommateId, status: "PENDING" },
    });
    sendSuccess(res, request, "Request sent to the current roommate for approval", 201);
  } catch (error) {
    sendError(res, "Failed to request bed", 500, (error as Error).message);
  }
};

/**
 * List room requests relevant to the caller (spec Section 13's
 * roommate-approval flow needed SOME way to discover a request exists
 * at all - requestBed only ever returned the single just-created
 * request to whoever called it; there was no way for the existing
 * roommate, or the requesting student themselves on a later visit, to
 * ever see it again).
 *  - STUDENT: their own record's requests, both as the one asking
 *    (`asRequester`) and as the existing roommate being asked
 *    (`asRoommate`).
 *  - PARENT: same, but for their linked child.
 *  - Branch staff (Admin/Warden): every request in their branch, so
 *    they can use the "staff override" respondToRoomRequest already
 *    supports.
 */
export const getRoomRequests = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const role = req.user!.role;

    if (role === UserRole.STUDENT || role === UserRole.PARENT) {
      let studentId: string | undefined;
      if (role === UserRole.STUDENT) {
        const student = await prisma.student.findUnique({ where: { userId: req.user!.userId }, select: { id: true } });
        studentId = student?.id;
      } else {
        const link = await prisma.studentParent.findFirst({ where: { parent: { userId: req.user!.userId } }, select: { studentId: true } });
        studentId = link?.studentId;
      }
      if (!studentId) { sendSuccess(res, { asRequester: [], asRoommate: [] }, "Room requests fetched"); return; }

      const include = {
        room: { select: { roomNo: true, floor: { select: { floorNo: true, building: { select: { name: true } } } } } },
        student: { select: { user: { select: { name: true } } } },
      };
      const [asRequester, asRoommate] = await Promise.all([
        prisma.hostelRoomRequest.findMany({ where: { studentId }, include, orderBy: { createdAt: "desc" } }),
        prisma.hostelRoomRequest.findMany({ where: { existingRoommateId: studentId, status: "PENDING" }, include, orderBy: { createdAt: "desc" } }),
      ]);
      sendSuccess(res, { asRequester, asRoommate }, "Room requests fetched");
      return;
    }

    // Branch staff: every request in scope, most recent first.
    const branchId = resolveBranchId(req);
    const requests = await prisma.hostelRoomRequest.findMany({
      where: { room: { floor: { building: { branchId } } } },
      include: {
        room: { select: { roomNo: true, floor: { select: { floorNo: true, building: { select: { name: true } } } } } },
        student: { select: { user: { select: { name: true } } } },
        existingRoommate: { select: { user: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });
    sendSuccess(res, { all: requests }, "Room requests fetched");
  } catch (error) {
    sendError(res, "Failed to fetch room requests", 500, (error as Error).message);
  }
};

/**
 * A STUDENT/PARENT's own current hostel status (spec Section 13's
 * self-service flow needs to know "am I already allotted, and to
 * where, and is it still provisional" before deciding whether to show
 * the request-bed flow at all) - no self-lookup like this existed;
 * getBuildings/getOccupancy return the whole branch's data, not
 * scoped to one student, and require staff-level authorize() anyway.
 */
export const getMyHostelStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const role = req.user!.role;
    let studentId: string | undefined;

    if (role === UserRole.STUDENT) {
      const student = await prisma.student.findUnique({ where: { userId: req.user!.userId }, select: { id: true } });
      studentId = student?.id;
    } else if (role === UserRole.PARENT) {
      const link = await prisma.studentParent.findFirst({ where: { parent: { userId: req.user!.userId } }, select: { studentId: true } });
      studentId = link?.studentId;
    } else {
      sendError(res, "This endpoint is only available to student/parent accounts", 403);
      return;
    }

    if (!studentId) { sendSuccess(res, null, "No linked student record"); return; }

    const allocation = await prisma.hostelAllocation.findUnique({
      where: { studentId },
      include: { room: { include: { floor: { include: { building: true } } } } },
    });

    if (!allocation || allocation.endDate) {
      sendSuccess(res, null, "No active hostel allocation");
      return;
    }

    sendSuccess(res, allocation, "Hostel status fetched");
  } catch (error) {
    sendError(res, "Failed to fetch hostel status", 500, (error as Error).message);
  }
};

/**
 * The existing roommate approves/rejects a new student's request to
 * join their occupied room (spec Section 13). Approval auto-allots
 * the requesting student; rejection leaves them to pick a different
 * suggested room / custom selection (see getSuggestedRooms below).
 */
export const respondToRoomRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { decision } = req.body; // "APPROVE" | "REJECT"

    const request = await prisma.hostelRoomRequest.findUnique({ where: { id }, include: { room: { include: { floor: { include: { building: true } } } } } });
    if (!request) { sendError(res, "Room request not found", 404); return; }
    if (request.status !== "PENDING") { sendError(res, "This request has already been decided", 400); return; }

    // Only the existing roommate themselves (or branch staff/warden as
    // an override) may respond.
    const roommate = await prisma.student.findUnique({ where: { id: request.existingRoommateId }, select: { userId: true } });
    const isRoommate = roommate?.userId === req.user!.userId;
    const isStaffOverride = canAccessBranch(req, request.room.floor.building.branchId) && req.user!.role !== "STUDENT" && req.user!.role !== "PARENT";
    if (!isRoommate && !isStaffOverride) {
      sendError(res, "Only the current roommate (or hostel staff) can respond to this request", 403);
      return;
    }

    if (decision === "REJECT") {
      const updated = await prisma.hostelRoomRequest.update({ where: { id }, data: { status: "REJECTED", respondedAt: new Date() } });
      sendSuccess(res, updated, "Request rejected - the student can pick a different room");
      return;
    }

    const room = await prisma.hostelRoom.findUnique({ where: { id: request.roomId } });
    if (!room || room.occupied >= room.capacity) {
      sendError(res, "Room is no longer available", 400);
      return;
    }

    await prisma.$transaction([
      prisma.hostelRoomRequest.update({ where: { id }, data: { status: "APPROVED", respondedAt: new Date() } }),
      prisma.hostelAllocation.upsert({
        where: { studentId: request.studentId },
        update: { roomId: request.roomId, startDate: new Date(), endDate: null, isProvisional: false },
        create: { studentId: request.studentId, roomId: request.roomId, startDate: new Date(), isProvisional: false },
      }),
      prisma.hostelRoom.update({ where: { id: request.roomId }, data: { occupied: { increment: 1 } } }),
    ]);

    sendSuccess(res, null, "Request approved - student allotted to the room");
  } catch (error) {
    sendError(res, "Failed to respond to room request", 500, (error as Error).message);
  }
};

/**
 * Next-suggested-available-room list for a student whose roommate
 * request was rejected (spec Section 13 - "shown next suggested
 * available room + can do custom room selection"). Custom selection
 * itself is just calling requestBed again with a hand-picked roomId;
 * this endpoint only powers the "suggested" part.
 */
export const getSuggestedRooms = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    if (!branchId) { sendError(res, "Branch ID required", 400); return; }

    // Prisma has no portable column-to-column ("occupied < capacity")
    // comparison in a `where` clause (same limitation noted in
    // inventory.controller.ts's getLowStockAlerts) - fetch candidate
    // rooms ordered by occupancy and filter in JS instead.
    const candidateRooms = await prisma.hostelRoom.findMany({
      where: { floor: { building: { branchId } } },
      include: { floor: { include: { building: { select: { name: true, type: true } } } } },
      orderBy: [{ occupied: "asc" }, { roomNo: "asc" }],
    });
    const rooms = candidateRooms.filter((r) => r.occupied < r.capacity).slice(0, 10);
    sendSuccess(res, rooms, "Suggested available rooms fetched");
  } catch (error) {
    sendError(res, "Failed to fetch suggested rooms", 500, (error as Error).message);
  }
};

/**
 * Warden sets/publishes the provisional-allotment cutoff date for a
 * room (spec Section 13).
 */
export const setAllotmentCutoff = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params; // roomId
    const { cutoffDate } = req.body;

    const room = await prisma.hostelRoom.findUnique({ where: { id }, include: { floor: { include: { building: true } } } });
    if (!room) { sendError(res, "Room not found", 404); return; }
    if (!canAccessBranch(req, room.floor.building.branchId)) { sendError(res, "Room not found", 404); return; }

    const updated = await prisma.hostelRoom.update({ where: { id }, data: { allotmentCutoffDate: new Date(cutoffDate) } });
    sendSuccess(res, updated, "Allotment cutoff date set");
  } catch (error) {
    sendError(res, "Failed to set allotment cutoff", 500, (error as Error).message);
  }
};

/**
 * Warden finalizes ALL provisional allotments in a building (spec
 * Section 13 - "Final allotment list published only after Warden
 * completes all approvals"). The Warden can also modify/override
 * individual allotments (via allocateRoom/deallocateRoom, unchanged)
 * before or after finalizing.
 */
export const finalizeHostelAllotments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { buildingId } = req.body;

    const building = await prisma.hostelBuilding.findUnique({ where: { id: buildingId } });
    if (!building) { sendError(res, "Building not found", 404); return; }
    if (!canAccessBranch(req, building.branchId)) { sendError(res, "Building not found", 404); return; }

    const result = await prisma.hostelAllocation.updateMany({
      where: { isProvisional: true, room: { floor: { buildingId } } },
      data: { isProvisional: false, finalizedBy: req.user!.userId, finalizedAt: new Date() },
    });

    sendSuccess(res, { finalized: result.count }, `${result.count} provisional allotment(s) finalized and published`);
  } catch (error) {
    sendError(res, "Failed to finalize allotments", 500, (error as Error).message);
  }
};

/**
 * RFID in/out tap for hostel entry/exit (spec Section 13) - presence
 * is derived from the LAST tap: an "in" with no subsequent "out" means
 * currently present/inside. Logs every tap to HostelTapEvent (full
 * history) and keeps HostelAllocation's denormalized
 * lastTapDirection/lastTapAt/isCurrentlyIn in sync for fast "who's in
 * right now" queries.
 */
export const hostelTap = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { studentId, direction, deviceId } = req.body; // direction: "IN" | "OUT"

    const allocation = await prisma.hostelAllocation.findUnique({ where: { studentId } });
    if (!allocation || allocation.endDate) {
      sendError(res, "This student has no active hostel room allocation", 404); return;
    }

    await prisma.$transaction([
      prisma.hostelTapEvent.create({ data: { allocationId: allocation.id, direction, deviceId } }),
      prisma.hostelAllocation.update({
        where: { id: allocation.id },
        data: { lastTapDirection: direction, lastTapAt: new Date(), isCurrentlyIn: direction === "IN" },
      }),
    ]);

    sendSuccess(res, { direction }, `Tap recorded - student is now ${direction === "IN" ? "inside" : "outside"} the hostel`);
  } catch (error) {
    sendError(res, "Failed to record hostel tap", 500, (error as Error).message);
  }
};

/**
 * Who's currently in the hostel (derived from each allocation's
 * denormalized isCurrentlyIn, kept in sync by hostelTap above) -
 * useful for a Warden's live roster view.
 */
export const getCurrentlyInHostel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    if (!branchId) { sendError(res, "Branch ID required", 400); return; }

    const allocations = await prisma.hostelAllocation.findMany({
      where: { endDate: null, isCurrentlyIn: true, room: { floor: { building: { branchId } } } },
      include: { student: { include: { user: { select: { name: true } } } }, room: { select: { roomNo: true } } },
      orderBy: { lastTapAt: "desc" },
    });
    sendSuccess(res, allocations, "Currently-in-hostel list fetched");
  } catch (error) {
    sendError(res, "Failed to fetch currently-in list", 500, (error as Error).message);
  }
};
