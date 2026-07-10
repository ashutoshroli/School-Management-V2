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
