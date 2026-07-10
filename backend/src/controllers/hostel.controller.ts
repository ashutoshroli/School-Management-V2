import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";

export const createBuilding = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { branchId, name, type, warden } = req.body;
    const building = await prisma.hostelBuilding.create({ data: { branchId, name, type, warden } });
    sendSuccess(res, building, "Building created", 201);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

export const getBuildings = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = req.query.branchId as string || req.user!.branchId;
    const buildings = await prisma.hostelBuilding.findMany({
      where: { branchId }, include: { floors: { include: { rooms: true } } }, orderBy: { name: "asc" },
    });
    sendSuccess(res, buildings, "Buildings fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

export const addFloor = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { buildingId, floorNo } = req.body;
    const floor = await prisma.hostelFloor.create({ data: { buildingId, floorNo } });
    sendSuccess(res, floor, "Floor added", 201);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

export const addRoom = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { floorId, roomNo, type, capacity, monthlyFee } = req.body;
    const room = await prisma.hostelRoom.create({ data: { floorId, roomNo, type, capacity, monthlyFee } });
    sendSuccess(res, room, "Room added", 201);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

export const allocateRoom = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { studentId, roomId, bedNo } = req.body;

    const room = await prisma.hostelRoom.findUnique({ where: { id: roomId } });
    if (!room || room.occupied >= room.capacity) { sendError(res, "Room full", 400); return; }

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
    const alloc = await prisma.hostelAllocation.findUnique({ where: { id } });
    if (!alloc) { sendError(res, "Not found", 404); return; }

    await prisma.hostelAllocation.update({ where: { id }, data: { endDate: new Date() } });
    await prisma.hostelRoom.update({ where: { id: alloc.roomId }, data: { occupied: { decrement: 1 } } });
    sendSuccess(res, null, "Room deallocated");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

export const getOccupancy = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = req.query.branchId as string || req.user!.branchId;
    const buildings = await prisma.hostelBuilding.findMany({
      where: { branchId },
      include: { floors: { include: { rooms: { include: { allocations: { where: { endDate: null }, include: { student: { include: { user: { select: { name: true } } } } } } } } } } },
    });
    sendSuccess(res, buildings, "Occupancy fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};
