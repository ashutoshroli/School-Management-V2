import crypto from "crypto";
import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { resolveBranchId, canAccessBranch } from "../utils/branchScope";
import { logAuditFromRequest } from "../services/auditLog.service";

/**
 * Attendance device (RFID/card-tap reader) management - Phase 5.
 *
 * Previously there was NO way to create an AttendanceDevice row through
 * the API at all (only the Prisma seed script could insert one) - the
 * `deviceId`/`apiKey` a physical reader needs to call
 * `POST /academics/attendance/card-tap` or
 * `POST /hr/attendance/card-tap` had to be hand-inserted into the
 * database. This gives branch admins a real self-service flow: create
 * a device, get back its `apiKey` once, configure the physical reader
 * with it, and rotate/deactivate it if a reader is lost or
 * decommissioned.
 */

/**
 * POST /api/facilities/attendance-devices
 * Registers a new device and returns its freshly-generated `apiKey`.
 * The apiKey is only ever returned here, at creation time - subsequent
 * reads (getDevices/getDeviceById) never include it (see the `select`
 * clauses below), so if it's lost, the only recovery path is
 * regenerateApiKey, not re-reading it from the API.
 */
export const createDevice = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, location } = req.body;
    const branchId = resolveBranchId(req);

    if (!branchId) {
      sendError(res, "branchId is required (Super Admin must specify one)", 400);
      return;
    }
    if (!canAccessBranch(req, branchId)) {
      sendError(res, "Access denied: branch mismatch", 403);
      return;
    }

    const device = await prisma.attendanceDevice.create({
      data: {
        branchId,
        name,
        location,
        deviceId: crypto.randomUUID(),
        apiKey: crypto.randomBytes(32).toString("hex"),
        isActive: true,
      },
    });

    logAuditFromRequest(req, "CREATE", "attendanceDevice", device.id, { newData: { ...device, apiKey: "[redacted]" } });

    // Full record (including apiKey) is returned ONLY on this create
    // response - the frontend must show/copy it immediately and warn
    // the user it won't be shown again.
    sendSuccess(res, device, "Device registered - copy the apiKey now, it will not be shown again", 201);
  } catch (error) {
    sendError(res, "Failed to register device", 500, (error as Error).message);
  }
};

/**
 * GET /api/facilities/attendance-devices
 * Lists devices for the caller's branch (or all branches for Super
 * Admin). Never includes `apiKey` in the response.
 */
export const getDevices = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    const where = branchId ? { branchId } : {};

    const devices = await prisma.attendanceDevice.findMany({
      where,
      select: {
        id: true,
        branchId: true,
        deviceId: true,
        name: true,
        location: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    sendSuccess(res, devices, "Devices fetched");
  } catch (error) {
    sendError(res, "Failed to fetch devices", 500, (error as Error).message);
  }
};

/**
 * PATCH /api/facilities/attendance-devices/:id
 * Updates name/location/isActive. Deactivating a device (isActive:
 * false) immediately blocks it from posting card-taps (enforced in
 * studentAttendance.controller.ts / staffAttendance.controller.ts) -
 * this is the primary way to respond to a lost/stolen reader.
 */
export const updateDevice = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, location, isActive } = req.body;

    const device = await prisma.attendanceDevice.findUnique({ where: { id } });
    if (!device) {
      sendError(res, "Device not found", 404);
      return;
    }
    if (!canAccessBranch(req, device.branchId)) {
      sendError(res, "Device not found", 404);
      return;
    }

    const updated = await prisma.attendanceDevice.update({
      where: { id },
      data: { name, location, isActive },
      select: { id: true, branchId: true, deviceId: true, name: true, location: true, isActive: true, updatedAt: true },
    });

    logAuditFromRequest(req, "UPDATE", "attendanceDevice", id, { oldData: device, newData: updated });

    sendSuccess(res, updated, "Device updated");
  } catch (error) {
    sendError(res, "Failed to update device", 500, (error as Error).message);
  }
};

/**
 * POST /api/facilities/attendance-devices/:id/regenerate-key
 * Issues a brand-new apiKey for an existing device (invalidating the
 * old one immediately) - the only way to recover a lost apiKey, or to
 * rotate credentials periodically without re-provisioning the device's
 * deviceId (which every stored attendance record references).
 */
export const regenerateApiKey = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const device = await prisma.attendanceDevice.findUnique({ where: { id } });
    if (!device) {
      sendError(res, "Device not found", 404);
      return;
    }
    if (!canAccessBranch(req, device.branchId)) {
      sendError(res, "Device not found", 404);
      return;
    }

    const updated = await prisma.attendanceDevice.update({
      where: { id },
      data: { apiKey: crypto.randomBytes(32).toString("hex") },
    });

    logAuditFromRequest(req, "UPDATE", "attendanceDevice", id, { newData: { apiKeyRegenerated: true } });

    sendSuccess(res, updated, "API key regenerated - copy it now, it will not be shown again");
  } catch (error) {
    sendError(res, "Failed to regenerate API key", 500, (error as Error).message);
  }
};

/**
 * DELETE /api/facilities/attendance-devices/:id
 */
export const deleteDevice = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const device = await prisma.attendanceDevice.findUnique({ where: { id } });
    if (!device) {
      sendError(res, "Device not found", 404);
      return;
    }
    if (!canAccessBranch(req, device.branchId)) {
      sendError(res, "Device not found", 404);
      return;
    }

    await prisma.attendanceDevice.delete({ where: { id } });

    logAuditFromRequest(req, "DELETE", "attendanceDevice", id, { oldData: { ...device, apiKey: "[redacted]" } });

    sendSuccess(res, null, "Device deleted");
  } catch (error) {
    sendError(res, "Failed to delete device", 500, (error as Error).message);
  }
};
