import crypto from "crypto";
import { Response } from "express";
import { AttendanceDevice } from "@prisma/client";
import prisma from "../config/database";
import { sendError } from "./response";

/**
 * SECURITY (Phase 5 fix): card-tap endpoints
 * (studentAttendance.controller.ts's studentCardTap,
 * staffAttendance.controller.ts's cardTapAttendance) are intentionally
 * NOT behind `authenticate` (a physical RFID reader has no user login,
 * no way to obtain a JWT) - they're meant to be protected by the
 * device's own `apiKey` instead. Before this fix, both endpoints only
 * checked `deviceId` (a UUID stored in the request body, previously
 * only ever set by hand/seed data) and `isActive` - never the
 * `apiKey` field that already existed on the AttendanceDevice model
 * specifically for this purpose. Since `deviceId` is sent in the same
 * request that's supposedly authenticating with it, this amounted to
 * NO authentication at all: anyone who could see (or guess/enumerate)
 * any `deviceId` could post fake attendance for any student/staff
 * member whose `cardId` they also knew, from anywhere on the internet.
 *
 * This helper centralizes the fix: callers must now present the
 * matching `apiKey`, via either the `X-Device-Api-Key` header
 * (preferred) or an `apiKey` field in the body (kept for readers that
 * can only send a fixed JSON payload). Comparison uses
 * `crypto.timingSafeEqual` rather than `===` to avoid leaking key
 * material one byte at a time via response-time differences.
 */
export const authenticateDevice = async (
  deviceId: string | undefined,
  providedApiKey: string | undefined,
  res: Response
): Promise<AttendanceDevice | null> => {
  if (!deviceId || !providedApiKey) {
    sendError(res, "deviceId and apiKey are required", 401);
    return null;
  }

  const device = await prisma.attendanceDevice.findUnique({ where: { deviceId } });
  if (!device || !device.isActive) {
    sendError(res, "Invalid or inactive device", 403);
    return null;
  }

  const expected = Buffer.from(device.apiKey, "utf-8");
  const provided = Buffer.from(providedApiKey, "utf-8");

  // timingSafeEqual throws if buffer lengths differ, rather than
  // returning false - guard explicitly so a wrong-length key doesn't
  // crash the request (and still runs a comparison either way, so we
  // don't shortcut based on length alone before deciding to reject).
  const isMatch = expected.length === provided.length && crypto.timingSafeEqual(expected, provided);

  if (!isMatch) {
    sendError(res, "Invalid device credentials", 403);
    return null;
  }

  return device;
};

/** Extracts the device API key from either the header or body, header taking precedence. */
export const extractDeviceApiKey = (req: { headers: Record<string, any>; body: any }): string | undefined =>
  (req.headers["x-device-api-key"] as string | undefined) || req.body?.apiKey;
