import { Response } from "express";
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
