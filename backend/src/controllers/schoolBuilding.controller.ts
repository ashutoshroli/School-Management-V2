import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { resolveBranchId, resolveEffectiveBranchId, canAccessBranch } from "../utils/branchScope";

/**
 * General-purpose (non-hostel) school building structure - Building ->
 * Floor -> Room, mirroring hostel.controller.ts's exact pattern
 * (including its branch-access fixes) but for classrooms/labs/
 * offices/etc rather than boarding. See schema.prisma's "SECTION 18B"
 * comment for why this is a separate model tree from Hostel*.
 */

export const createSchoolBuilding = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, description } = req.body;
    // Same "form has no branch-picker" fix as hostel.controller.ts's
    // createBuilding - req.body.branchId would otherwise arrive as "".
    const branchId = resolveEffectiveBranchId(req, req.body.branchId);

    if (!branchId) {
      sendError(res, "Branch ID could not be resolved - please select a branch", 400);
      return;
    }
    if (!canAccessBranch(req, branchId)) {
      sendError(res, "Access denied: branch mismatch", 403);
      return;
    }

    const building = await prisma.schoolBuilding.create({ data: { branchId, name, description } });
    sendSuccess(res, building, "Building created", 201);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

export const getSchoolBuildings = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    const buildings = await prisma.schoolBuilding.findMany({
      where: { branchId },
      include: {
        floors: {
          include: {
            rooms: {
              include: {
                // A CLASSROOM room's real occupancy is its linked
                // section's live student count, not a stored counter -
                // include just enough of the section to compute that
                // (and to show "Class 5 - A" against the room) without
                // a second round trip.
                sections: { include: { class: { select: { name: true } }, _count: { select: { students: true } } } },
                assignedStaff: { include: { user: { select: { name: true } } } },
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
 * addFloor/addRoom/updateRoom/deleteRoom/deleteBuilding below all
 * resolve the referenced building's OWN branchId from the DB (via its
 * floor/room chain) and require canAccessBranch for it - same IDOR fix
 * already applied to hostel.controller.ts's equivalents.
 */

export const addSchoolFloor = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { buildingId, floorNo, name } = req.body;

    const building = await prisma.schoolBuilding.findUnique({ where: { id: buildingId } });
    if (!building) { sendError(res, "Building not found", 404); return; }
    if (!canAccessBranch(req, building.branchId)) { sendError(res, "Building not found", 404); return; }

    const floor = await prisma.schoolFloor.create({ data: { buildingId, floorNo, name } });
    sendSuccess(res, floor, "Floor added", 201);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

export const addSchoolRoom = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { floorId, roomNo, name, type, capacity, directionFromGate, assignedStaffId, department } = req.body;

    const floor = await prisma.schoolFloor.findUnique({ where: { id: floorId }, include: { building: true } });
    if (!floor) { sendError(res, "Floor not found", 404); return; }
    if (!canAccessBranch(req, floor.building.branchId)) { sendError(res, "Floor not found", 404); return; }

    // If a staff member is being assigned this room (chamber/office),
    // they must belong to the SAME branch as the building - same
    // cross-check convention as hostel's allocateRoom (student vs room
    // branch) and transport's assignVehicleToRoute (vehicle vs route).
    if (assignedStaffId) {
      const staff = await prisma.staff.findUnique({ where: { id: assignedStaffId } });
      if (!staff || staff.branchId !== floor.building.branchId) {
        sendError(res, "Assigned staff must belong to the same branch as this building", 400);
        return;
      }
    }

    const room = await prisma.schoolRoom.create({
      data: { floorId, roomNo, name, type, capacity: capacity || 0, directionFromGate, assignedStaffId, department },
    });
    sendSuccess(res, room, "Room added", 201);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

export const updateSchoolRoom = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { roomNo, name, type, capacity, directionFromGate, assignedStaffId, department } = req.body;

    const room = await prisma.schoolRoom.findUnique({ where: { id }, include: { floor: { include: { building: true } } } });
    if (!room) { sendError(res, "Room not found", 404); return; }
    if (!canAccessBranch(req, room.floor.building.branchId)) { sendError(res, "Room not found", 404); return; }

    if (assignedStaffId) {
      const staff = await prisma.staff.findUnique({ where: { id: assignedStaffId } });
      if (!staff || staff.branchId !== room.floor.building.branchId) {
        sendError(res, "Assigned staff must belong to the same branch as this building", 400);
        return;
      }
    }

    const updated = await prisma.schoolRoom.update({
      where: { id },
      data: {
        ...(roomNo !== undefined && { roomNo }),
        ...(name !== undefined && { name }),
        ...(type !== undefined && { type }),
        ...(capacity !== undefined && { capacity }),
        ...(directionFromGate !== undefined && { directionFromGate }),
        ...(assignedStaffId !== undefined && { assignedStaffId }),
        ...(department !== undefined && { department }),
      },
    });
    sendSuccess(res, updated, "Room updated");
  } catch (error) { sendError(res, "Failed to update room", 500, (error as Error).message); }
};

/**
 * Delete a room. Blocked if any Section is currently linked to it -
 * unlink the section (or move it to a different room) first, same
 * "block delete, don't cascade real data" convention used throughout
 * this codebase (deleteFeeCategory, deleteLeaveType, etc).
 */
export const deleteSchoolRoom = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const room = await prisma.schoolRoom.findUnique({ where: { id }, include: { floor: { include: { building: true } } } });
    if (!room) { sendError(res, "Room not found", 404); return; }
    if (!canAccessBranch(req, room.floor.building.branchId)) { sendError(res, "Room not found", 404); return; }

    const linkedSectionCount = await prisma.section.count({ where: { roomId: id } });
    if (linkedSectionCount > 0) {
      sendError(res, `Cannot delete: ${linkedSectionCount} section(s) are assigned to this room. Reassign them first.`, 400);
      return;
    }

    await prisma.schoolRoom.delete({ where: { id } });
    sendSuccess(res, null, "Room deleted");
  } catch (error) { sendError(res, "Failed to delete room", 500, (error as Error).message); }
};

/**
 * Delete a building. Blocked if any of its rooms still has a Section
 * assigned to it, or (as a floor-level check) simply has any rooms at
 * all left - same idea as hostel's deleteBuilding, simplified since
 * there's no allocations table here, just direct Section links.
 */
export const deleteSchoolBuilding = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const building = await prisma.schoolBuilding.findUnique({ where: { id } });
    if (!building) { sendError(res, "Building not found", 404); return; }
    if (!canAccessBranch(req, building.branchId)) { sendError(res, "Building not found", 404); return; }

    const linkedSectionCount = await prisma.section.count({
      where: { room: { floor: { buildingId: id } } },
    });
    if (linkedSectionCount > 0) {
      sendError(res, `Cannot delete: ${linkedSectionCount} section(s) are assigned to rooms in this building. Reassign them first.`, 400);
      return;
    }

    await prisma.$transaction(async (tx) => {
      const floors = await tx.schoolFloor.findMany({ where: { buildingId: id }, select: { id: true } });
      const floorIds = floors.map((f) => f.id);
      await tx.schoolRoom.deleteMany({ where: { floorId: { in: floorIds } } });
      await tx.schoolFloor.deleteMany({ where: { buildingId: id } });
      await tx.schoolBuilding.delete({ where: { id } });
    });

    sendSuccess(res, null, "Building deleted");
  } catch (error) { sendError(res, "Failed to delete building", 500, (error as Error).message); }
};

/**
 * Creates N floors on one building in a single call (e.g. "set up an
 * entire new building: 4 floors") instead of N separate addSchoolFloor
 * calls. Floor numbers are auto-sequenced from `startingFloorNo`
 * (default 0 = ground floor); names are auto-generated as "Floor N"
 * unless a `namePrefix` is given (e.g. namePrefix "Wing A" -> "Wing A
 * Floor 1", "Wing A Floor 2", ...).
 */
export const bulkAddSchoolFloors = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { buildingId, count, startingFloorNo, namePrefix } = req.body;

    const building = await prisma.schoolBuilding.findUnique({ where: { id: buildingId } });
    if (!building) { sendError(res, "Building not found", 404); return; }
    if (!canAccessBranch(req, building.branchId)) { sendError(res, "Building not found", 404); return; }

    const start = startingFloorNo ?? 0;
    const floors = Array.from({ length: count }, (_, i) => ({
      buildingId,
      floorNo: start + i,
      name: namePrefix ? `${namePrefix} Floor ${start + i}` : null,
    }));

    // createMany (one INSERT) rather than a loop of N addSchoolFloor
    // calls - the whole point of "bulk" here is avoiding N round trips
    // for what's normally a "set up a whole building at once" action.
    await prisma.schoolFloor.createMany({ data: floors });

    const created = await prisma.schoolFloor.findMany({
      where: { buildingId, floorNo: { in: floors.map((f) => f.floorNo) } },
      orderBy: { floorNo: "asc" },
    });
    sendSuccess(res, created, `${created.length} floor(s) added`, 201);
  } catch (error) { sendError(res, "Failed to add floors", 500, (error as Error).message); }
};

/**
 * Creates a whole list of rooms on one floor in a single call (e.g.
 * "8 classrooms on this floor") instead of one addSchoolRoom call per
 * room. Applies the exact same assignedStaffId branch-ownership guard
 * as the single-room endpoint, but checked once up front for every
 * room in the list (rather than N separate lookups) so a bad staffId
 * anywhere in the batch fails the WHOLE call before anything is
 * written - a partial bulk-create (7 of 8 rooms created, 1 silently
 * skipped) would be a confusing result for what's meant to be one
 * atomic "set up this floor" action.
 */
export const bulkAddSchoolRooms = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { floorId, rooms } = req.body;

    const floor = await prisma.schoolFloor.findUnique({ where: { id: floorId }, include: { building: true } });
    if (!floor) { sendError(res, "Floor not found", 404); return; }
    if (!canAccessBranch(req, floor.building.branchId)) { sendError(res, "Floor not found", 404); return; }

    const staffIds = [...new Set(rooms.map((r: any) => r.assignedStaffId).filter(Boolean))] as string[];
    if (staffIds.length > 0) {
      const staffRows = await prisma.staff.findMany({ where: { id: { in: staffIds } } });
      const staffById = new Map(staffRows.map((s) => [s.id, s]));
      for (const staffId of staffIds) {
        const staff = staffById.get(staffId);
        if (!staff || staff.branchId !== floor.building.branchId) {
          sendError(res, `Assigned staff (${staffId}) must belong to the same branch as this building`, 400);
          return;
        }
      }
    }

    await prisma.schoolRoom.createMany({
      data: rooms.map((r: any) => ({
        floorId,
        roomNo: r.roomNo,
        name: r.name || null,
        type: r.type,
        capacity: r.capacity || 0,
        directionFromGate: r.directionFromGate || null,
        assignedStaffId: r.assignedStaffId || null,
        department: r.department || null,
      })),
    });

    const created = await prisma.schoolRoom.findMany({
      where: { floorId, roomNo: { in: rooms.map((r: any) => r.roomNo) } },
      orderBy: { roomNo: "asc" },
    });
    sendSuccess(res, created, `${created.length} room(s) added`, 201);
  } catch (error) { sendError(res, "Failed to add rooms", 500, (error as Error).message); }
};

/**
 * Multi-cabin chambers (RoomCabin) - see the model's doc comment in
 * schema.prisma. addRoomCabin/updateRoomCabin/deleteRoomCabin/
 * getRoomCabins below all resolve the cabin's OWN room's branchId from
 * the DB and require canAccessBranch, same convention as every other
 * facilities endpoint above.
 */

export const addRoomCabin = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { roomId, cabinNo, staffId } = req.body;

    const room = await prisma.schoolRoom.findUnique({ where: { id: roomId }, include: { floor: { include: { building: true } } } });
    if (!room) { sendError(res, "Room not found", 404); return; }
    if (!canAccessBranch(req, room.floor.building.branchId)) { sendError(res, "Room not found", 404); return; }

    if (staffId) {
      const staff = await prisma.staff.findUnique({ where: { id: staffId } });
      if (!staff || staff.branchId !== room.floor.building.branchId) {
        sendError(res, "Assigned staff must belong to the same branch as this building", 400);
        return;
      }
    }

    const cabin = await prisma.roomCabin.create({ data: { roomId, cabinNo, staffId: staffId || null } });
    sendSuccess(res, cabin, "Cabin added", 201);
  } catch (error) { sendError(res, "Failed to add cabin", 500, (error as Error).message); }
};

export const getRoomCabins = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { roomId } = req.params;

    const room = await prisma.schoolRoom.findUnique({ where: { id: roomId }, include: { floor: { include: { building: true } } } });
    if (!room) { sendError(res, "Room not found", 404); return; }
    if (!canAccessBranch(req, room.floor.building.branchId)) { sendError(res, "Room not found", 404); return; }

    const cabins = await prisma.roomCabin.findMany({
      where: { roomId },
      include: { staff: { include: { user: { select: { name: true } } } } },
      orderBy: { cabinNo: "asc" },
    });
    sendSuccess(res, cabins, "Cabins fetched");
  } catch (error) { sendError(res, "Failed to fetch cabins", 500, (error as Error).message); }
};

export const updateRoomCabin = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { cabinNo, staffId } = req.body;

    const cabin = await prisma.roomCabin.findUnique({ where: { id }, include: { room: { include: { floor: { include: { building: true } } } } } });
    if (!cabin) { sendError(res, "Cabin not found", 404); return; }
    if (!canAccessBranch(req, cabin.room.floor.building.branchId)) { sendError(res, "Cabin not found", 404); return; }

    if (staffId) {
      const staff = await prisma.staff.findUnique({ where: { id: staffId } });
      if (!staff || staff.branchId !== cabin.room.floor.building.branchId) {
        sendError(res, "Assigned staff must belong to the same branch as this building", 400);
        return;
      }
    }

    const updated = await prisma.roomCabin.update({
      where: { id },
      data: {
        ...(cabinNo !== undefined && { cabinNo }),
        ...(staffId !== undefined && { staffId: staffId || null }),
      },
    });
    sendSuccess(res, updated, "Cabin updated");
  } catch (error) { sendError(res, "Failed to update cabin", 500, (error as Error).message); }
};

export const deleteRoomCabin = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const cabin = await prisma.roomCabin.findUnique({ where: { id }, include: { room: { include: { floor: { include: { building: true } } } } } });
    if (!cabin) { sendError(res, "Cabin not found", 404); return; }
    if (!canAccessBranch(req, cabin.room.floor.building.branchId)) { sendError(res, "Cabin not found", 404); return; }

    await prisma.roomCabin.delete({ where: { id } });
    sendSuccess(res, null, "Cabin deleted");
  } catch (error) { sendError(res, "Failed to delete cabin", 500, (error as Error).message); }
};

/**
 * Branch-wide occupancy summary: total rooms, a room-type breakdown
 * (count per type), and for CLASSROOM-type rooms specifically, vacant
 * vs filled seats derived from each linked section's live student
 * count against the room's capacity - the "full rooms management"
 * dashboard view.
 */
export const getSchoolOccupancySummary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);

    const rooms = await prisma.schoolRoom.findMany({
      where: { floor: { building: { branchId } } },
      include: {
        floor: { include: { building: { select: { id: true, name: true } } } },
        sections: { include: { class: { select: { name: true } }, _count: { select: { students: true } } } },
      },
    });

    const byType: Record<string, number> = {};
    let totalCapacity = 0;
    let totalOccupied = 0;
    const classroomDetail = [];

    for (const room of rooms) {
      byType[room.type] = (byType[room.type] || 0) + 1;

      if (room.type === "CLASSROOM") {
        // Only CLASSROOM-type rooms count toward the `classrooms`
        // capacity/occupied totals below - a lab/office/toilet's
        // capacity is a different kind of number (bench count, chair
        // count) that isn't comparable to a classroom's seat count and
        // would otherwise silently inflate this figure.
        totalCapacity += room.capacity;
        const occupied = room.sections.reduce((sum, s) => sum + s._count.students, 0);
        totalOccupied += occupied;
        classroomDetail.push({
          roomId: room.id,
          roomNo: room.roomNo,
          buildingName: room.floor.building.name,
          capacity: room.capacity,
          occupied,
          vacant: Math.max(room.capacity - occupied, 0),
          sections: room.sections.map((s) => `${s.class.name} - ${s.name}`),
        });
      }
    }

    sendSuccess(
      res,
      {
        totalRooms: rooms.length,
        roomTypeBreakdown: byType,
        classrooms: { totalCapacity, totalOccupied, totalVacant: Math.max(totalCapacity - totalOccupied, 0), detail: classroomDetail },
      },
      "Occupancy summary fetched"
    );
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};
