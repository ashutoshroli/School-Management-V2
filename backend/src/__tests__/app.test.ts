import request from "supertest";
import app from "../app";

/**
 * Lightweight HTTP-level smoke tests using supertest against the real
 * Express app (no live database needed for these particular routes -
 * the health check doesn't touch Prisma, and the auth-required routes
 * fail with 401 before any DB query happens).
 */
describe("GET /api/health", () => {
  it("returns a success payload", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/running/i);
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
