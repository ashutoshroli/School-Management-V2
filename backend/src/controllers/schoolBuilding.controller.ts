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
