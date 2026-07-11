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

    if (room.occupied >= room.capacity) { sendError(res, "Room full", 400); return; }

    const alloc = await prisma.hostelAllocation.create({
      data: { studentId, roomId, bedNo, startDate: new Date() },
    });
    await prisma.hostelRoom.update({ where: { id: roomId }, data: { occupied: { increment: 1 } } });
    sendSuccess(res, alloc, "Room allocated", 201);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
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
