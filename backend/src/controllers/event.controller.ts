import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError, sendPaginated } from "../utils/response";
import { resolveEffectiveBranchId } from "../utils/branchScope";

/**
 * POST /events - Create a new event
 */
export const createEvent = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveEffectiveBranchId(req);
    const { title, description, type, startDate, endDate, startTime, endTime, venue, targetAudience, targetClassId, isRecurring, maxParticipants } = req.body;

    const event = await prisma.event.create({
      data: {
        branchId,
        title,
        description,
        type,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        startTime,
        endTime,
        venue,
        organizer: req.user!.userId,
        targetAudience,
        targetClassId,
        isRecurring: isRecurring || false,
        maxParticipants,
      },
    });

    sendSuccess(res, event, "Event created successfully", 201);
  } catch (error) {
    sendError(res, "Failed to create event", 500, (error as Error).message);
  }
};

/**
 * GET /events - List events for the branch
 */
export const getEvents = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveEffectiveBranchId(req);
    const { type, status, page = "1", limit = "20" } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);

    const where: any = { branchId };
    if (type) where.type = type;
    if (status) where.status = status;

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where,
        orderBy: { startDate: "desc" },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        include: { _count: { select: { attendees: true } } },
      }),
      prisma.event.count({ where }),
    ]);

    sendPaginated(res, events, total, pageNum, limitNum);
  } catch (error) {
    sendError(res, "Failed to fetch events", 500, (error as Error).message);
  }
};

/**
 * GET /events/:id - Get event details
 */
export const getEventById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const event = await prisma.event.findUnique({
      where: { id: req.params.id },
      include: { attendees: true },
    });

    if (!event) {
      sendError(res, "Event not found", 404);
      return;
    }

    sendSuccess(res, event);
  } catch (error) {
    sendError(res, "Failed to fetch event", 500, (error as Error).message);
  }
};

/**
 * PUT /events/:id - Update an event
 */
export const updateEvent = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const data = req.body;

    if (data.startDate) data.startDate = new Date(data.startDate);
    if (data.endDate) data.endDate = new Date(data.endDate);

    const event = await prisma.event.update({
      where: { id },
      data,
    });

    sendSuccess(res, event, "Event updated successfully");
  } catch (error) {
    sendError(res, "Failed to update event", 500, (error as Error).message);
  }
};

/**
 * DELETE /events/:id - Delete an event
 */
export const deleteEvent = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.eventAttendee.deleteMany({ where: { eventId: req.params.id } });
    await prisma.event.delete({ where: { id: req.params.id } });
    sendSuccess(res, null, "Event deleted successfully");
  } catch (error) {
    sendError(res, "Failed to delete event", 500, (error as Error).message);
  }
};

/**
 * POST /events/:id/rsvp - RSVP to an event
 */
export const rsvpEvent = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status } = req.body; // ACCEPTED, DECLINED

    const attendee = await prisma.eventAttendee.upsert({
      where: { eventId_userId: { eventId: id, userId: req.user!.userId } },
      update: { rsvpStatus: status },
      create: { eventId: id, userId: req.user!.userId, rsvpStatus: status },
    });

    sendSuccess(res, attendee, "RSVP updated");
  } catch (error) {
    sendError(res, "Failed to RSVP", 500, (error as Error).message);
  }
};
