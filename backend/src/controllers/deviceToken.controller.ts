import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";

/**
 * POST /api/notifications/devices/register
 * Registers (or re-links) a push-notification device token for the
 * current user. Called by the mobile/web app right after login and on
 * every app foreground, so a re-installed app (which gets a new FCM
 * token) or a token handed to a different logged-in user always ends
 * up owned by the correct user.
 *
 * `token` is globally unique (see DeviceToken.token @unique in the
 * schema) - if the same token is already registered to someone else
 * (e.g. previous user logged out, new user logged in on the same
 * device without the app clearing state), we reassign it rather than
 * erroring, since the token physically identifies "this app install",
 * not a specific account.
 */
export const registerDeviceToken = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { token, platform } = req.body;

    if (!token || typeof token !== "string") {
      sendError(res, "token is required", 400);
      return;
    }
    if (!["IOS", "ANDROID", "WEB"].includes(platform)) {
      sendError(res, "platform must be one of IOS, ANDROID, WEB", 400);
      return;
    }

    const record = await prisma.deviceToken.upsert({
      where: { token },
      update: { userId: req.user!.userId, platform },
      create: { token, platform, userId: req.user!.userId },
    });

    sendSuccess(res, record, "Device registered for push notifications");
  } catch (error) {
    sendError(res, "Failed to register device", 500, (error as Error).message);
  }
};

/**
 * DELETE /api/notifications/devices/:token
 * Unregisters a device token (e.g. on logout) so it stops receiving
 * push notifications for this user.
 */
export const unregisterDeviceToken = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { token } = req.params;

    // Only allow a user to delete their OWN token registration -
    // otherwise any authenticated user could pass another user's known
    // token value and unregister their push notifications (minor, but
    // unnecessary IDOR).
    const existing = await prisma.deviceToken.findUnique({ where: { token } });
    if (!existing || existing.userId !== req.user!.userId) {
      // Return success either way - the end state (this token isn't
      // registered to this user) is what the caller wants, and we
      // don't want to leak whether a token exists for someone else.
      sendSuccess(res, null, "Device unregistered");
      return;
    }

    await prisma.deviceToken.delete({ where: { token } });
    sendSuccess(res, null, "Device unregistered");
  } catch (error) {
    sendError(res, "Failed to unregister device", 500, (error as Error).message);
  }
};
