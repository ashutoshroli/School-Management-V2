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
      where: { branchId },
      include: {
        stops: { orderBy: { order: "asc" } },
        _count: { select: { allocations: true } },
        // Needed by the frontend's "Manage Students" panel (Transport
        // page) - lists who's currently allocated so they can be
        // removed, and is what the "Assign Fee to Allocated Students"
        // flow (assignTransportFee, feeCollection.controller.ts)
        // targets. Kept lightweight (no fee/payment data) since this
        // is just a roster view.
        allocations: {
          include: {
            student: {
              select: {
                id: true,
                admissionNo: true,
                rollNo: true,
                user: { select: { name: true } },
                class: { select: { name: true } },
                section: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { name: "asc" },
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

    if (!studentId || !routeId) { sendError(res, "studentId and routeId are required", 400); return; }

    const route = await prisma.transportRoute.findUnique({ where: { id: routeId } });
    if (!route) { sendError(res, "Route not found", 404); return; }
    if (!canAccessBranch(req, route.branchId)) { sendError(res, "Route not found", 404); return; }

    // SECURITY: without this, a Branch Admin could allocate a student
    // from a completely different branch onto their own route (the
    // studentId is just a string from the request body, never
    // cross-checked before) - which would then let that student's
    // fee get assigned through assignTransportFee too.
    const student = await prisma.student.findUnique({ where: { id: studentId }, select: { branchId: true } });
    if (!student) { sendError(res, "Student not found", 404); return; }
    if (student.branchId !== route.branchId) { sendError(res, "Student does not belong to this route's branch", 403); return; }

    const alloc = await prisma.transportAllocation.upsert({
      where: { studentId },
      update: { routeId, stopName },
      create: { studentId, routeId, stopName },
    });
    sendSuccess(res, alloc, "Student allocated to route");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Removes a student's transport allocation entirely (they no longer
 * use transport / are switching routes outside the upsert flow above).
 * Does NOT touch any FeeAssignment already created for them via
 * assignTransportFee - a fee already assigned/paid for past months
 * shouldn't vanish just because the allocation record is deleted; an
 * admin can still waive/refund it separately (Fees > Collect Payment)
 * if needed.
 */
export const removeAllocation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { studentId } = req.params;

    const allocation = await prisma.transportAllocation.findUnique({
      where: { studentId },
      include: { route: { select: { branchId: true } } },
    });
    if (!allocation) { sendError(res, "This student is not allocated to any route", 404); return; }
    if (!canAccessBranch(req, allocation.route.branchId)) { sendError(res, "This student is not allocated to any route", 404); return; }

    await prisma.transportAllocation.delete({ where: { studentId } });
    sendSuccess(res, null, "Student removed from route");
  } catch (error) { sendError(res, "Failed to remove allocation", 500, (error as Error).message); }
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

/**
 * Delete a vehicle. Removes its route assignments first (a join table,
 * safe to clear) - the vehicle itself has no student-facing dependents.
 */
export const deleteVehicle = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const vehicle = await prisma.vehicle.findUnique({ where: { id } });
    if (!vehicle) { sendError(res, "Vehicle not found", 404); return; }
    if (!canAccessBranch(req, vehicle.branchId)) { sendError(res, "Vehicle not found", 404); return; }

    await prisma.vehicleRoute.deleteMany({ where: { vehicleId: id } });
    await prisma.vehicle.delete({ where: { id } });
    sendSuccess(res, null, "Vehicle deleted");
  } catch (error) { sendError(res, "Failed to delete vehicle", 500, (error as Error).message); }
};

/**
 * Delete a transport route. Blocked if any student is currently
 * allocated to it - reassign/remove those allocations first.
 */
export const deleteRoute = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const route = await prisma.transportRoute.findUnique({ where: { id } });
    if (!route) { sendError(res, "Route not found", 404); return; }
    if (!canAccessBranch(req, route.branchId)) { sendError(res, "Route not found", 404); return; }

    const allocationCount = await prisma.transportAllocation.count({ where: { routeId: id } });
    if (allocationCount > 0) {
      sendError(res, `Cannot delete: ${allocationCount} student(s) are allocated to this route. Reassign them first.`, 400);
      return;
    }

    await prisma.transportStop.deleteMany({ where: { routeId: id } });
    await prisma.vehicleRoute.deleteMany({ where: { routeId: id } });
    await prisma.transportRoute.delete({ where: { id } });
    sendSuccess(res, null, "Route deleted");
  } catch (error) { sendError(res, "Failed to delete route", 500, (error as Error).message); }
};
