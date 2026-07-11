import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { resolveBranchId, resolveEffectiveBranchId, canAccessBranch } from "../utils/branchScope";

export const createRoute = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, startPoint, endPoint, distance, monthlyFee } = req.body;
    // BUG FIX + SECURITY: the "Add Route" form has no branch-picker, so
    // req.body.branchId always arrived as "" - see
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

    const route = await prisma.transportRoute.create({ data: { branchId, name, startPoint, endPoint, distance, monthlyFee, isActive: true } });
    sendSuccess(res, route, "Route created", 201);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

export const getRoutes = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    const routes = await prisma.transportRoute.findMany({
      where: { branchId }, include: { stops: { orderBy: { order: "asc" } }, _count: { select: { allocations: true } } }, orderBy: { name: "asc" },
    });
    sendSuccess(res, routes, "Routes fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

export const addStop = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { routeId, name, order, time } = req.body;
    const stop = await prisma.transportStop.create({ data: { routeId, name, order, time } });
    sendSuccess(res, stop, "Stop added", 201);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

export const allocateStudent = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { studentId, routeId, stopName } = req.body;
    const alloc = await prisma.transportAllocation.upsert({
      where: { studentId },
      update: { routeId, stopName },
      create: { studentId, routeId, stopName },
    });
    sendSuccess(res, alloc, "Student allocated to route");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

export const getVehicles = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    const vehicles = await prisma.vehicle.findMany({ where: { branchId }, orderBy: { vehicleNo: "asc" } });
    sendSuccess(res, vehicles, "Vehicles fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

export const addVehicle = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { vehicleNo, type, capacity, driverName, driverPhone, driverLicense } = req.body;
    // BUG FIX + SECURITY: same as createRoute above - no branch-picker
    // in the "Add Vehicle" form, and no canAccessBranch check existed.
    const branchId = resolveEffectiveBranchId(req, req.body.branchId);

    if (!branchId) {
      sendError(res, "Branch ID could not be resolved - please select a branch", 400);
      return;
    }
    if (!canAccessBranch(req, branchId)) {
      sendError(res, "Access denied: branch mismatch", 403);
      return;
    }

    const vehicle = await prisma.vehicle.create({ data: { branchId, vehicleNo, type, capacity, driverName, driverPhone, driverLicense, isActive: true } });
    sendSuccess(res, vehicle, "Vehicle added", 201);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};
