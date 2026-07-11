jest.mock("../../config/redis", () => ({
  isRedisConfigured: jest.fn(),
  getRedisClient: jest.fn(),
}));

jest.mock("../../config/logger", () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import { isRedisConfigured, getRedisClient } from "../../config/redis";
import {
  cacheGet,
  cacheSet,
  cacheDel,
  cached,
  CacheKeys,
  CacheTTL,
  invalidateClassesCache,
  invalidateFeeStructuresCache,
  invalidateBranchesCache,
} from "../cache.service";

describe("cache.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("when Redis is not configured", () => {
    beforeEach(() => {
      (isRedisConfigured as jest.Mock).mockReturnValue(false);
    });

    it("cacheGet always returns null (cache miss)", async () => {
      expect(await cacheGet("some-key")).toBeNull();
      expect(getRedisClient).not.toHaveBeenCalled();
    });

    it("cacheSet is a no-op", async () => {
      await cacheSet("some-key", { a: 1 }, 60);
      expect(getRedisClient).not.toHaveBeenCalled();
    });

    it("cacheDel is a no-op", async () => {
      await cacheDel("some-key");
      expect(getRedisClient).not.toHaveBeenCalled();
    });

    it("cached() falls through directly to the loader and does not throw", async () => {
      const loader = jest.fn().mockResolvedValue({ id: "abc" });
      const result = await cached("k", 60, loader);
      expect(result).toEqual({ id: "abc" });
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("invalidate* helpers are no-ops and never throw", async () => {
      await expect(invalidateClassesCache("branch-1")).resolves.toBeUndefined();
      await expect(invalidateFeeStructuresCache("branch-1")).resolves.toBeUndefined();
      await expect(invalidateBranchesCache("branch-1")).resolves.toBeUndefined();
    });
  });

  describe("when Redis is configured and healthy", () => {
    const mockRedis = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      scan: jest.fn(),
    };

    beforeEach(() => {
      (isRedisConfigured as jest.Mock).mockReturnValue(true);
      (getRedisClient as jest.Mock).mockReturnValue(mockRedis);
      mockRedis.get.mockReset();
      mockRedis.set.mockReset();
      mockRedis.del.mockReset();
      mockRedis.scan.mockReset();
    });

    it("cacheGet returns the parsed JSON value on a hit", async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ id: "abc" }));
      const result = await cacheGet<{ id: string }>("some-key");
      expect(result).toEqual({ id: "abc" });
      expect(mockRedis.get).toHaveBeenCalledWith("school-erp:some-key");
    });

    it("cacheGet returns null on a miss", async () => {
      mockRedis.get.mockResolvedValue(null);
      expect(await cacheGet("some-key")).toBeNull();
    });

    it("cacheGet returns null (not throw) if Redis errors", async () => {
      mockRedis.get.mockRejectedValue(new Error("connection reset"));
      expect(await cacheGet("some-key")).toBeNull();
    });

    it("cacheSet stores JSON with the given TTL", async () => {
      mockRedis.set.mockResolvedValue("OK");
      await cacheSet("some-key", { a: 1 }, 120);
      expect(mockRedis.set).toHaveBeenCalledWith("school-erp:some-key", JSON.stringify({ a: 1 }), "EX", 120);
    });

    it("cacheSet does not throw if Redis errors", async () => {
      mockRedis.set.mockRejectedValue(new Error("connection reset"));
      await expect(cacheSet("some-key", { a: 1 }, 60)).resolves.toBeUndefined();
    });

    it("cacheDel deletes a single exact key", async () => {
      mockRedis.del.mockResolvedValue(1);
      await cacheDel("some-key");
      expect(mockRedis.del).toHaveBeenCalledWith("school-erp:some-key");
    });

    it("cacheDel scans and deletes every matching key for a wildcard pattern", async () => {
      mockRedis.scan.mockResolvedValueOnce(["0", ["school-erp:fee-structures:branch:b1:y1", "school-erp:fee-structures:branch:b1:y2"]]);
      mockRedis.del.mockResolvedValue(2);
      await cacheDel("fee-structures:branch:b1:*");
      expect(mockRedis.scan).toHaveBeenCalledWith("0", "MATCH", "school-erp:fee-structures:branch:b1:*", "COUNT", 100);
      expect(mockRedis.del).toHaveBeenCalledWith(
        "school-erp:fee-structures:branch:b1:y1",
        "school-erp:fee-structures:branch:b1:y2"
      );
    });

    it("cached() returns the cached value without calling the loader on a hit", async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify(["cached-value"]));
      const loader = jest.fn().mockResolvedValue(["fresh-value"]);
      const result = await cached("k", 60, loader);
      expect(result).toEqual(["cached-value"]);
      expect(loader).not.toHaveBeenCalled();
    });

    it("cached() calls the loader and caches the result on a miss", async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.set.mockResolvedValue("OK");
      const loader = jest.fn().mockResolvedValue(["fresh-value"]);
      const result = await cached("k", 60, loader);
      expect(result).toEqual(["fresh-value"]);
      expect(loader).toHaveBeenCalledTimes(1);
      expect(mockRedis.set).toHaveBeenCalledWith("school-erp:k", JSON.stringify(["fresh-value"]), "EX", 60);
    });

    it("cached() does not cache a null/undefined loader result", async () => {
      mockRedis.get.mockResolvedValue(null);
      const loader = jest.fn().mockResolvedValue(null);
      const result = await cached("k", 60, loader);
      expect(result).toBeNull();
      expect(mockRedis.set).not.toHaveBeenCalled();
    });

    it("invalidateBranchesCache clears both the list and a specific branch's key", async () => {
      mockRedis.del.mockResolvedValue(1);
      await invalidateBranchesCache("branch-1");
      expect(mockRedis.del).toHaveBeenCalledWith("school-erp:branches:all");
      expect(mockRedis.del).toHaveBeenCalledWith("school-erp:branches:branch-1");
    });

    it("invalidateBranchesCache without a branchId only clears the list", async () => {
      mockRedis.del.mockResolvedValue(1);
      await invalidateBranchesCache();
      expect(mockRedis.del).toHaveBeenCalledTimes(1);
      expect(mockRedis.del).toHaveBeenCalledWith("school-erp:branches:all");
    });

    it("invalidateClassesCache clears the branch's class-list key", async () => {
      mockRedis.del.mockResolvedValue(1);
      await invalidateClassesCache("branch-1");
      expect(mockRedis.del).toHaveBeenCalledWith("school-erp:classes:branch:branch-1");
    });
  });

  describe("CacheKeys / CacheTTL", () => {
    it("produces stable, namespaced key strings", () => {
      expect(CacheKeys.branches()).toBe("branches:all");
      expect(CacheKeys.branchById("b1")).toBe("branches:b1");
      expect(CacheKeys.classesByBranch("b1")).toBe("classes:branch:b1");
      expect(CacheKeys.feeStructuresByBranch("b1")).toBe("fee-structures:branch:b1:all");
      expect(CacheKeys.feeStructuresByBranch("b1", "y1")).toBe("fee-structures:branch:b1:y1");
    });

    it("defines a positive TTL (in seconds) for every cached namespace", () => {
      expect(CacheTTL.BRANCHES).toBeGreaterThan(0);
      expect(CacheTTL.CLASSES).toBeGreaterThan(0);
      expect(CacheTTL.FEE_STRUCTURES).toBeGreaterThan(0);
    });
  });
});
