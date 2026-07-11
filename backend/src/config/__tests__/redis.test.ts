jest.mock("../index", () => ({
  config: { redis: { url: "" } },
}));

jest.mock("../logger", () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import { config } from "../index";
import { isRedisConfigured, getRedisClient } from "../redis";

describe("redis config", () => {
  beforeEach(() => {
    (config as any).redis.url = "";
  });

  it("isRedisConfigured returns false when REDIS_URL is unset", () => {
    expect(isRedisConfigured()).toBe(false);
  });

  it("getRedisClient returns null when REDIS_URL is unset (no ioredis connection attempted)", () => {
    expect(getRedisClient()).toBeNull();
  });

  it("isRedisConfigured returns true once REDIS_URL is set", () => {
    (config as any).redis.url = "redis://localhost:6379";
    expect(isRedisConfigured()).toBe(true);
  });
});
