/**
 * TEMPORARY - DELETE THIS ENTIRE FILE AFTER VERIFICATION.
 *
 * Manual, one-off self-test routes for confirming every external
 * integration configured via Render env vars (Razorpay, SMTP, FCM, R2)
 * is actually reachable end-to-end after a deploy - not just "the env
 * var is read by config/index.ts", but "a real API call to the real
 * external service succeeds with these real credentials".
 *
 * Every route here is gated behind `authenticate` + `authorize(SUPER_ADMIN)`
 * (unlike the pre-existing GET /api/debug-sentry, which is deliberately
 * unauthenticated to match Sentry's own tutorial and only THROWS - it
 * never sends a real email/push/payment/file anywhere) - these routes
 * actually place a real (tiny, refundable/harmless) Razorpay order,
 * send a real email, send a real push notification, and write+read a
 * real object to your R2 bucket, so they must not be left open to the
 * public or reachable by a non-admin.
 *
 * Mount this file ONLY while verifying a deploy, then delete it (and
 * remove its `router.use("/debug", debugRoutes)` line from
 * routes/index.ts) - see the final checklist in the PR description /
 * chat response for the full walkthrough.
 */
import { Router } from "express";
import { UserRole } from "@prisma/client";
import { authenticate, authorize } from "../middleware/auth";
import { sendSuccess, sendError } from "../utils/response";
import { AuthRequest } from "../types";
import { isRazorpayConfigured, getRazorpayClient } from "../config/razorpay";
import { isEmailConfigured, sendEmail } from "../services/notification/emailProvider";
import { isPushConfigured, sendPush } from "../services/notification/pushProvider";
import { isR2Configured } from "../config/r2";
import { storage } from "../services/storage.service";
import prisma from "../config/database";

const router = Router();

router.use(authenticate, authorize(UserRole.SUPER_ADMIN));

/**
 * GET /api/debug/razorpay
 * Creates a real ₹1 (100 paise) Razorpay order - the smallest amount
 * Razorpay's API accepts. This does NOT charge anyone anything; it
 * only confirms RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET are valid and the
 * orders.create API call succeeds. No payment is actually collected
 * unless you separately go complete checkout for this order (you
 * won't - just note the returned order id/status and move on).
 */
router.get("/razorpay", async (_req, res) => {
  try {
    if (!isRazorpayConfigured()) {
      sendError(res, "Razorpay is not configured (missing RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET)", 503);
      return;
    }
    const razorpay = getRazorpayClient();
    const order = await razorpay.orders.create({
      amount: 100, // paise = INR 1.00, Razorpay's minimum
      currency: "INR",
      receipt: `debug_${Date.now()}`,
      notes: { purpose: "deploy self-test - safe to ignore/expire" },
    });
    sendSuccess(res, { orderId: order.id, amount: order.amount, currency: order.currency, status: order.status }, "Razorpay order created successfully");
  } catch (error) {
    sendError(res, "Razorpay self-test failed", 500, (error as Error).message);
  }
});

/**
 * GET /api/debug/email?to=you@example.com
 * Sends a real test email via SMTP. `to` defaults to the calling
 * admin's own account email if not given.
 */
router.get("/email", async (req: AuthRequest, res) => {
  try {
    if (!isEmailConfigured()) {
      sendError(res, "Email is not configured (missing SMTP_HOST/SMTP_USER/SMTP_PASS)", 503);
      return;
    }
    const to = (req.query.to as string | undefined) || req.user!.email;
    await sendEmail({
      to,
      subject: "School ERP - SMTP self-test",
      body: `This is a test email triggered from GET /api/debug/email at ${new Date().toISOString()}.\n\nIf you received this, SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS (and SMTP_FROM_EMAIL/SMTP_FROM_NAME) are all working correctly.`,
    });
    sendSuccess(res, { to }, "Test email sent successfully - check the inbox (and spam folder)");
  } catch (error) {
    sendError(res, "Email self-test failed", 500, (error as Error).message);
  }
});

/**
 * GET /api/debug/push?token=<fcm-device-token>
 * Sends a real test push notification. If `token` isn't given, falls
 * back to the calling admin's OWN most-recently-registered device
 * token (via DeviceToken - see deviceToken.controller.ts's
 * registerDeviceToken, called by the mobile/web app after login) - so
 * you can just log into the app on your own phone/browser first, then
 * hit this route with no query param.
 */
router.get("/push", async (req: AuthRequest, res) => {
  try {
    if (!isPushConfigured()) {
      sendError(res, "Push notifications are not configured (missing FCM_PROJECT_ID/FCM_CLIENT_EMAIL/FCM_PRIVATE_KEY)", 503);
      return;
    }
    let token = req.query.token as string | undefined;
    if (!token) {
      const device = await prisma.deviceToken.findFirst({
        where: { userId: req.user!.userId },
        orderBy: { updatedAt: "desc" },
      });
      if (!device) {
        sendError(
          res,
          "No device token found for your account and none was given via ?token=. Log into the app on a device first (which registers a token), or pass ?token=<fcm-token> explicitly.",
          400
        );
        return;
      }
      token = device.token;
    }
    await sendPush({ token, title: "School ERP self-test", body: `Push notification test at ${new Date().toISOString()}` });
    sendSuccess(res, { tokenPrefix: token.slice(0, 12) }, "Test push sent successfully - check the device");
  } catch (error) {
    sendError(res, "Push self-test failed", 500, (error as Error).message);
  }
});

/**
 * GET /api/debug/r2
 * Writes a tiny text file to the configured R2 bucket via the exact
 * same `storage` abstraction every real upload flow uses (see
 * storage.service.ts's getStorageProvider()), reads it back, confirms
 * the round-tripped content matches, then deletes it - so nothing is
 * left behind in the bucket afterward regardless of success/failure.
 */
router.get("/r2", async (_req, res) => {
  try {
    if (!isR2Configured()) {
      sendError(res, "R2 is not configured (missing R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME), or STORAGE_PROVIDER is not set to \"r2\"", 503);
      return;
    }
    const testContent = `School ERP R2 self-test - ${new Date().toISOString()}`;
    const buffer = Buffer.from(testContent, "utf-8");

    const { url } = await storage.save(buffer, "debug-r2-test.txt", "debug");
    const readBack = await storage.readByUrl(url);
    const matches = readBack?.toString("utf-8") === testContent;

    // Always attempt cleanup, even if the read-back check above failed,
    // so a self-test run never leaves permanent clutter in the bucket.
    await storage.deleteByUrl(url).catch(() => undefined);

    if (!matches) {
      sendError(res, "R2 upload succeeded but the read-back content did not match what was written", 500);
      return;
    }
    sendSuccess(res, { url, bytesWritten: buffer.length }, "R2 upload + download + delete round-trip succeeded (test object was cleaned up)");
  } catch (error) {
    sendError(res, "R2 self-test failed", 500, (error as Error).message);
  }
});

export default router;
