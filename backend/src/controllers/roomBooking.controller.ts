import { Response } from "express";
import { UserRole } from "@prisma/client";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { resolveBranchId, resolveEffectiveBranchId, canAccessBranch } from "../utils/branchScope";

/**
 * Shared-room booking workflow (spec Section 4 - "Shared room booking
 * (Conference Room, Auditorium, etc.) requires Principal approval").
 */

export const requestRoomBooking = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { roomId, purpose, startTime, endTime } = req.body;
    const branchId = resolveEffectiveBranchId(req, req.body.branchId);
    if (!branchId) { sendError(res, "Branch ID could not be resolved", 400); return; }
    if (!canAccessBranch(req, branchId)) { sendError(res, "Access denied", 403); return; }

    const room = await prisma.schoolRoom.findUnique({ where: { id: roomId }, include: { floor: { include: { building: true } } } });
    if (!room) { sendError(res, "Room not found", 404); return; }
    if (room.floor.building.branchId !== branchId) { sendError(res, "Room not found", 404); return; }

    const requester = await prisma.staff.findUnique({ where: { userId: req.user!.userId } });
    if (!requester) { sendError(res, "Staff record not found for the requesting user", 404); return; }

    const start = new Date(startTime);
    const end = new Date(endTime);
    if (end <= start) { sendError(res, "endTime must be after startTime", 400); return; }

    // Overlap warning (not a hard block) - flag any existing
    // APPROVED/PENDING booking on the same room that overlaps this
    // window, but let the request through; the Principal's approval
    // step is the real gate.
    const overlapping = await prisma.roomBooking.findMany({
      where: {
        roomId,
        status: { in: ["PENDING", "APPROVED"] },
        startTime: { lt: end },
        endTime: { gt: start },
      },
    });

    const booking = await prisma.roomBooking.create({
      data: { branchId, roomId, requestedById: requester.id, purpose, startTime: start, endTime: end, status: "PENDING" },
    });

    sendSuccess(
      res,
      { booking, overlapWarning: overlapping.length > 0 ? `${overlapping.length} other booking(s) overlap this time window` : null },
      "Room booking requested - pending Principal approval",
      201
    );
  } catch (error) {
    sendError(res, "Failed to request room booking", 500, (error as Error).message);
  }
};

export const getRoomBookings = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    const status = req.query.status as string | undefined;
    const roomId = req.query.roomId as string | undefined;

    const where: any = { branchId };
    if (status) where.status = status;
    if (roomId) where.roomId = roomId;

    const bookings = await prisma.roomBooking.findMany({
      where,
      include: {
        room: { select: { roomNo: true, name: true, type: true } },
        requestedBy: { include: { user: { select: { name: true } } } },
      },
      orderBy: { startTime: "desc" },
    });
    sendSuccess(res, bookings, "Room bookings fetched");
  } catch (error) {
    sendError(res, "Failed to fetch room bookings", 500, (error as Error).message);
  }
};

/**
 * Principal approval/rejection (spec Section 4). Restricted at the
 * route level to PRINCIPAL/VICE_PRINCIPAL/ADMIN roles.
 */
export const respondToRoomBooking = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { decision, rejectionReason } = req.body;

    const booking = await prisma.roomBooking.findUnique({ where: { id } });
    if (!booking) { sendError(res, "Booking not found", 404); return; }
    if (!canAccessBranch(req, booking.branchId)) { sendError(res, "Booking not found", 404); return; }
    if (booking.status !== "PENDING") { sendError(res, "This booking has already been decided", 400); return; }

    const updated = await prisma.roomBooking.update({
      where: { id },
      data: {
        status: decision === "APPROVE" ? "APPROVED" : "REJECTED",
        approvedBy: req.user!.userId,
        approvedAt: new Date(),
        ...(decision === "REJECT" && { rejectionReason }),
      },
    });
    sendSuccess(res, updated, `Booking ${decision === "APPROVE" ? "approved" : "rejected"}`);
  } catch (error) {
    sendError(res, "Failed to respond to room booking", 500, (error as Error).message);
  }
};

export const cancelRoomBooking = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const booking = await prisma.roomBooking.findUnique({ where: { id } });
    if (!booking) { sendError(res, "Booking not found", 404); return; }
    if (!canAccessBranch(req, booking.branchId)) { sendError(res, "Booking not found", 404); return; }

    const requester = await prisma.staff.findUnique({ where: { userId: req.user!.userId } });
    const isOwner = requester && requester.id === booking.requestedById;
    const isAdmin = req.user!.role === UserRole.SUPER_ADMIN || req.user!.role === UserRole.BRANCH_ADMIN || req.user!.role === UserRole.PRINCIPAL;
    if (!isOwner && !isAdmin) { sendError(res, "Only the requester or an admin/principal can cancel this booking", 403); return; }

    const updated = await prisma.roomBooking.update({ where: { id }, data: { status: "CANCELLED" } });
    sendSuccess(res, updated, "Booking cancelled");
  } catch (error) {
    sendError(res, "Failed to cancel room booking", 500, (error as Error).message);
  }
};
