import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { resolveBranchId, canAccessBranch } from "../utils/branchScope";

/**
 * Diesel payment flow (spec Section 11): Driver raises request (amount
 * + litres) -> Transport Manager approves -> Accounts (account-
 * transfer request) -> Director approves payment -> Online = payment
 * transferred, Not online = Accounts releases cash directly.
 *
 * Rejection handling: driver notified with reason (the rejectionReason
 * field itself IS that notification payload - the frontend surfaces
 * it), can re-request, capped at max 3 re-requests per week. The week
 * boundary uses the branch's configured attendanceWeekCycleDays
 * (custom week concept, spec Section 6) for consistency with the rest
 * of the app rather than a hardcoded Mon-Sun week.
 */

const MAX_REREQUESTS_PER_WEEK = 3;

/**
 * Counts how many diesel requests this driver has raised within the
 * current week-cycle window (branch's configured cycle length,
 * ending "now"), for the 3-re-request-per-week cap.
 */
const countRequestsThisWeekCycle = async (branchId: string, driverId: string): Promise<number> => {
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { attendanceWeekCycleDays: true } });
  const cycleDays = branch?.attendanceWeekCycleDays || 7;
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - cycleDays);

  return prisma.dieselRequest.count({
    where: { branchId, driverId, createdAt: { gte: windowStart } },
  });
};

export const raiseDieselRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { vehicleId, amount, litres } = req.body;

    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) { sendError(res, "Vehicle not found", 404); return; }
    if (!canAccessBranch(req, vehicle.branchId)) { sendError(res, "Vehicle not found", 404); return; }

    const driver = await prisma.staff.findUnique({ where: { userId: req.user!.userId } });
    if (!driver) { sendError(res, "Driver staff record not found", 404); return; }

    // Cap re-requests at 3/week (spec Section 11). Only counts REJECTED
    // -then-resubmitted requests toward the cap in spirit, but since
    // the spec's cap is simply "re-requests per week" without a more
    // precise definition, this counts ALL requests raised by this
    // driver in the current week-cycle - a driver's first-ever request
    // in a cycle still counts as request #1 toward this same limit.
    const countThisWeek = await countRequestsThisWeekCycle(vehicle.branchId, driver.id);
    if (countThisWeek >= MAX_REREQUESTS_PER_WEEK) {
      sendError(res, `Maximum of ${MAX_REREQUESTS_PER_WEEK} diesel requests per week already reached`, 400);
      return;
    }

    // Auto-calculate distance from route x perKmRate, view-only
    // snapshot (spec Section 11) - uses the route's diesel-distance
    // override if the Transport Manager has set one, else the
    // measured distance.
    const route = await prisma.transportRoute.findFirst({
      where: { vehicles: { some: { vehicleId } } },
    });
    const distanceKm = route ? Number(route.dieselDistanceOverride ?? route.distance ?? 0) : null;

    const request = await prisma.dieselRequest.create({
      data: {
        branchId: vehicle.branchId, vehicleId, driverId: driver.id, amount, litres, distanceKm,
        stage: "INCHARGE_REQUESTED",
      },
    });
    sendSuccess(res, request, "Diesel request raised - pending Transport Manager approval", 201);
  } catch (error) { sendError(res, "Failed to raise diesel request", 500, (error as Error).message); }
};

export const getDieselRequests = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    const stage = req.query.stage as string | undefined;
    const where: any = { branchId };
    if (stage) where.stage = stage;

    const requests = await prisma.dieselRequest.findMany({
      where,
      include: {
        vehicle: { select: { vehicleNo: true } },
        driver: { include: { user: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });
    sendSuccess(res, requests, "Diesel requests fetched");
  } catch (error) { sendError(res, "Failed to fetch diesel requests", 500, (error as Error).message); }
};

/**
 * Advances (or rejects) a diesel request through the approval chain -
 * Transport Manager -> Accounts -> Director, mirroring the shared
 * ApprovalChainStage enum used by CanteenStockRequest/
 * InventoryPurchaseRequest.
 */
export const advanceDieselRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { decision, rejectionReason, paymentMode } = req.body; // decision: "APPROVE" | "REJECT"

    const request = await prisma.dieselRequest.findUnique({ where: { id } });
    if (!request) { sendError(res, "Diesel request not found", 404); return; }
    if (!canAccessBranch(req, request.branchId)) { sendError(res, "Diesel request not found", 404); return; }

    if (decision === "REJECT") {
      const updated = await prisma.dieselRequest.update({
        where: { id },
        data: { stage: "REJECTED", rejectionReason },
      });
      sendSuccess(res, updated, "Diesel request rejected - driver may re-request (up to the weekly cap)");
      return;
    }

    const approverId = req.user!.userId;
    if (request.stage === "INCHARGE_REQUESTED") {
      const updated = await prisma.dieselRequest.update({
        where: { id },
        data: { stage: "MANAGER_APPROVED", managerApprovedBy: approverId, managerApprovedAt: new Date() },
      });
      sendSuccess(res, updated, "Approved by Transport Manager - forwarded to Accounts");
      return;
    }
    if (request.stage === "MANAGER_APPROVED") {
      const updated = await prisma.dieselRequest.update({
        where: { id },
        data: { stage: "ACCOUNTS_APPROVED", accountsApprovedBy: approverId, accountsApprovedAt: new Date() },
      });
      sendSuccess(res, updated, "Approved by Accounts - forwarded to Director for payment approval");
      return;
    }
    if (request.stage === "ACCOUNTS_APPROVED") {
      if (!paymentMode) { sendError(res, "paymentMode (ONLINE_TRANSFER or CASH) is required for the Director's payment approval", 400); return; }
      const updated = await prisma.dieselRequest.update({
        where: { id },
        data: {
          stage: "DIRECTOR_APPROVED", directorApprovedBy: approverId, directorApprovedAt: new Date(),
          paymentMode,
          ...(paymentMode === "CASH" && { stage: "PAID", paidAt: new Date() }),
        },
      });
      sendSuccess(res, updated, paymentMode === "CASH" ? "Director approved - cash released by Accounts" : "Director approved - payment transferred online");
      return;
    }
    if (request.stage === "DIRECTOR_APPROVED") {
      const updated = await prisma.dieselRequest.update({ where: { id }, data: { stage: "PAID", paidAt: new Date() } });
      sendSuccess(res, updated, "Payment marked as transferred");
      return;
    }

    sendError(res, "This request has already completed its approval chain", 400);
  } catch (error) { sendError(res, "Failed to advance diesel request", 500, (error as Error).message); }
};
