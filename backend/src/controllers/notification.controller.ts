import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";

/**
 * GET /api/notifications
 * Returns the current user's own notifications, most recent first.
 * This is what drives the bell icon in the header.
 *
 * Note: the Notification model's `status` field (PENDING/SENT/FAILED)
 * tracks delivery status, not read/unread - there's no "read" concept
 * in the current schema, and adding one would need a migration (out of
 * scope for this change). The frontend instead tracks "last seen" via
 * localStorage and treats anything newer as unread - see
 * frontend/src/components/layout/NotificationBell.tsx.
 */
export const getMyNotifications = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

    const notifications = await prisma.notification.findMany({
      where: { userId: req.user!.userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    sendSuccess(res, notifications, "Notifications fetched");
  } catch (error) {
    sendError(res, "Failed to fetch notifications", 500, (error as Error).message);
  }
};
