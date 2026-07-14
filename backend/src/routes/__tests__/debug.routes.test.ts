jest.mock("../../config/razorpay", () => ({
  isRazorpayConfigured: jest.fn().mockReturnValue(false),
  getRazorpayClient: jest.fn(),
}));

jest.mock("../../services/notification/emailProvider", () => ({
  isEmailConfigured: jest.fn().mockReturnValue(false),
  sendEmail: jest.fn(),
}));

jest.mock("../../services/notification/pushProvider", () => ({
  isPushConfigured: jest.fn().mockReturnValue(false),
  sendPush: jest.fn(),
}));

jest.mock("../../config/r2", () => ({
  isR2Configured: jest.fn().mockReturnValue(false),
}));

jest.mock("../../services/storage.service", () => ({
  storage: { save: jest.fn(), readByUrl: jest.fn(), deleteByUrl: jest.fn() },
}));

import request from "supertest";
import { UserRole } from "@prisma/client";
import app from "../../app";
import { generateAccessToken } from "../../utils/jwt";

/**
 * These tests only verify the AUTHORIZATION gating (SUPER_ADMIN-only)
 * and the "not configured -> 503" fallback path for each debug route -
 * they deliberately do NOT exercise the "actually configured and
 * succeeds" path, since that would require real Razorpay/SMTP/FCM/R2
 * credentials and would place a real order / send a real email/push /
 * touch a real bucket, which has no place in an automated test suite.
 * Manual, real-credential verification is exactly what these routes
 * exist for post-deploy - see the PR description / debug.routes.ts's
 * header comment for that walkthrough.
 */
describe("debug.routes (TEMPORARY - delete alongside debug.routes.ts)", () => {
  const nonAdminToken = generateAccessToken({
    userId: "teacher-1",
    email: "teacher@test.com",
    role: UserRole.TEACHER,
    branchId: "branch-1",
  });
  const superAdminToken = generateAccessToken({
    userId: "admin-1",
    email: "admin@test.com",
    role: UserRole.SUPER_ADMIN,
    branchId: "branch-1",
  });

  const debugPaths = ["/api/debug/razorpay", "/api/debug/email", "/api/debug/push", "/api/debug/r2"];

  it.each(debugPaths)("SECURITY: rejects an unauthenticated request to %s with 401", async (path) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(401);
  });

  it.each(debugPaths)("SECURITY: rejects a non-SUPER_ADMIN authenticated request to %s with 403", async (path) => {
    const res = await request(app).get(path).set("Authorization", `Bearer ${nonAdminToken}`);
    expect(res.status).toBe(403);
  });

  it("GET /api/debug/razorpay returns 503 when Razorpay is not configured", async () => {
    const res = await request(app).get("/api/debug/razorpay").set("Authorization", `Bearer ${superAdminToken}`);
    expect(res.status).toBe(503);
  });

  it("GET /api/debug/email returns 503 when SMTP is not configured", async () => {
    const res = await request(app).get("/api/debug/email").set("Authorization", `Bearer ${superAdminToken}`);
    expect(res.status).toBe(503);
  });

  it("BUG FIX: GET /api/debug/email includes the raw SMTP error detail in the response even when NODE_ENV=production, instead of only a generic message", async () => {
    const { isEmailConfigured, sendEmail } = require("../../services/notification/emailProvider");
    isEmailConfigured.mockReturnValue(true);
    const smtpError: any = new Error("Invalid login: 535 5.7.8 Authentication failed");
    smtpError.code = "EAUTH";
    smtpError.command = "AUTH LOGIN";
    smtpError.responseCode = 535;
    smtpError.response = "535 5.7.8 Authentication failed";
    sendEmail.mockRejectedValue(smtpError);

    const res = await request(app).get("/api/debug/email").set("Authorization", `Bearer ${superAdminToken}`);

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    // This is the exact bug being fixed: sendError() strips `error` for
    // 5xx responses outside development, so a plain sendError() call
    // here would only ever show "Email self-test failed" on Render
    // (NODE_ENV=production) - this route deliberately bypasses that.
    expect(res.body.error.message).toBe("Invalid login: 535 5.7.8 Authentication failed");
    expect(res.body.error.code).toBe("EAUTH");
    expect(res.body.error.responseCode).toBe(535);
    expect(res.body.smtpConfig).toBeDefined();
    expect(res.body.smtpConfig.host).toBeDefined();

    isEmailConfigured.mockReturnValue(false); // reset for other tests in this file
  });

  it("GET /api/debug/push returns 503 when FCM is not configured", async () => {
    const res = await request(app).get("/api/debug/push").set("Authorization", `Bearer ${superAdminToken}`);
    expect(res.status).toBe(503);
  });

  it("GET /api/debug/r2 returns 503 when R2 is not configured", async () => {
    const res = await request(app).get("/api/debug/r2").set("Authorization", `Bearer ${superAdminToken}`);
    expect(res.status).toBe(503);
  });
});
