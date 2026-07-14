import request from "supertest";
import app from "../app";

/**
 * Lightweight HTTP-level smoke tests using supertest against the real
 * Express app (no live database needed for these particular routes -
 * the health check doesn't touch Prisma, and the auth-required routes
 * fail with 401 before any DB query happens).
 */
describe("GET /api/health", () => {
  it("returns a success payload, always with HTTP 200 regardless of dependency status", async () => {
    const res = await request(app).get("/api/health");
    // Always 200 even if the database/redis checks below report
    // "fail" - see routes/index.ts's comment on why this must never
    // vary with dependency status (Render's own health monitor points
    // at this exact route and would restart-loop the service otherwise).
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/running/i);
  });

  it("reports database and redis dependency status in the body", async () => {
    const res = await request(app).get("/api/health");
    // No real Postgres/Redis is running in this test environment, so
    // these are expected to report "fail"/"not_configured" - the point
    // of this test is only that the fields exist with one of the
    // documented values, not a specific value.
    expect(["ok", "fail"]).toContain(res.body.database);
    expect(["ok", "fail", "not_configured"]).toContain(res.body.redis);
  });
});

describe("Authentication requirement", () => {
  it("rejects an unauthenticated request to a protected route with 401", async () => {
    const res = await request(app).get("/api/students");
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("rejects a request with a malformed bearer token with 401", async () => {
    const res = await request(app).get("/api/students").set("Authorization", "Bearer not-a-real-token");
    expect(res.status).toBe(401);
  });
});

describe("Unknown routes", () => {
  it("returns 404 for a route that doesn't exist", async () => {
    const res = await request(app).get("/api/this-route-does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

describe("GET /api/debug-sentry", () => {
  it("throws and is converted into a 500 response by the error handler (confirms the route is wired up for Sentry verification)", async () => {
    const res = await request(app).get("/api/debug-sentry");
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

// Phase 1 (Communication) - device registration and fee reminders both
// require auth; these smoke tests confirm the routes are actually
// mounted and reachable (would 404 if a route file typo'd the path)
// without needing a live database.
describe("Phase 1 communication routes require authentication", () => {
  it("rejects an unauthenticated device registration request with 401", async () => {
    const res = await request(app)
      .post("/api/communication/notifications/devices/register")
      .send({ token: "tok", platform: "ANDROID" });
    expect(res.status).toBe(401);
  });

  it("rejects an unauthenticated fee-reminder send request with 401", async () => {
    const res = await request(app).post("/api/fees/reminders/send");
    expect(res.status).toBe(401);
  });
});
