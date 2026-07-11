import { getRedisClient, isRedisConfigured } from "../config/redis";
import { logger } from "../config/logger";

/**
 * Thin caching helper (Phase 4). Every function here degrades to a
 * safe no-op (cache miss / no-op invalidate) whenever Redis isn't
 * configured or a Redis call itself fails - callers must never behave
 * differently (let alone throw) just because the cache is unavailable;
 * worst case is simply "as slow as before this phase existed", not a
 * broken request.
 *
 * Cache key convention: "school-erp:<namespace>:<...ids>", scoped by
 * branchId wherever the underlying data is branch-scoped, so cached
 * data for one branch can never leak into another branch's response
 * and invalidation for one branch never has to guess at (or
 * accidentally clear) another's.
 */

const KEY_PREFIX = "school-erp";

/** Fetches a cached JSON value, or null on a miss/parse-failure/disabled-cache. */
export const cacheGet = async <T>(key: string): Promise<T | null> => {
  if (!isRedisConfigured()) return null;
  try {
    const redis = getRedisClient();
    if (!redis) return null;
    const raw = await redis.get(`${KEY_PREFIX}:${key}`);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch (error) {
    logger.warn("Cache get failed - falling back to source", { key, errorMessage: (error as Error).message });
    return null;
  }
};

/** Stores a JSON-serializable value with a TTL (seconds). No-op if Redis is disabled/unreachable. */
export const cacheSet = async (key: string, value: unknown, ttlSeconds: number): Promise<void> => {
  if (!isRedisConfigured()) return;
  try {
    const redis = getRedisClient();
    if (!redis) return;
    await redis.set(`${KEY_PREFIX}:${key}`, JSON.stringify(value), "EX", ttlSeconds);
  } catch (error) {
    logger.warn("Cache set failed (non-fatal, data just won't be cached)", { key, errorMessage: (error as Error).message });
  }
};

/**
 * Deletes a single cache key or every key matching a prefix (pass a
 * key ending in "*"). Used for invalidation on create/update/delete -
 * see cacheInvalidate() below for the common branch-scoped case.
 */
export const cacheDel = async (keyOrPattern: string): Promise<void> => {
  if (!isRedisConfigured()) return;
  try {
    const redis = getRedisClient();
    if (!redis) return;
    const fullPattern = `${KEY_PREFIX}:${keyOrPattern}`;
    if (!fullPattern.includes("*")) {
      await redis.del(fullPattern);
      return;
    }
    // SCAN instead of KEYS - KEYS blocks the whole Redis instance while
    // it walks the keyspace; SCAN is the non-blocking, production-safe
    // equivalent. Cache namespaces here are small (per-branch master
    // data), so this is a handful of round trips at most, not a
    // performance concern.
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", fullPattern, "COUNT", 100);
      cursor = nextCursor;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== "0");
  } catch (error) {
    logger.warn("Cache invalidation failed (non-fatal, stale data may briefly persist)", {
      keyOrPattern,
      errorMessage: (error as Error).message,
    });
  }
};

/**
 * Cache-aside helper: returns the cached value if present, otherwise
 * calls `loader()`, caches its result, and returns it. This is the
 * primary entry point most read endpoints should use rather than
 * calling cacheGet/cacheSet directly.
 */
export const cached = async <T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> => {
  const hit = await cacheGet<T>(key);
  if (hit !== null) return hit;

  const value = await loader();
  // Don't cache null/undefined results - an empty result is often a
  // transient "not created yet" state (e.g. a branch with zero classes
  // right after creation) that should be re-checked on the next
  // request, not frozen in the cache for the full TTL.
  if (value !== null && value !== undefined) {
    await cacheSet(key, value, ttlSeconds);
  }
  return value;
};

// ===== Cache key namespaces + TTLs =====
// Centralized here so invalidation call sites (in controllers) and
// read call sites agree on the exact same key shape without importing
// each other.

export const CacheKeys = {
  branches: () => "branches:all",
  branchById: (branchId: string) => `branches:${branchId}`,
  classesByBranch: (branchId: string) => `classes:branch:${branchId}`,
  feeStructuresByBranch: (branchId: string, academicYearId?: string) =>
    `fee-structures:branch:${branchId}:${academicYearId || "all"}`,
};

export const CacheTTL = {
  BRANCHES: 60 * 60 * 24, // 1 day - branch list/details change rarely
  CLASSES: 60 * 60, // 1 hour - classes/sections change occasionally
  FEE_STRUCTURES: 60 * 60, // 1 hour - fee structures change occasionally, never mid-request
};

/** Invalidates every cached class/section list for a branch (call after any Class/Section create/update/delete). */
export const invalidateClassesCache = (branchId: string): Promise<void> => cacheDel(CacheKeys.classesByBranch(branchId));

/** Invalidates cached fee structures for a branch (call after any FeeStructure create/update/delete). */
export const invalidateFeeStructuresCache = (branchId: string): Promise<void> => cacheDel(`fee-structures:branch:${branchId}:*`);

/** Invalidates both the branch list and a specific branch's detail cache (call after any Branch create/update/delete). */
export const invalidateBranchesCache = async (branchId?: string): Promise<void> => {
  await cacheDel(CacheKeys.branches());
  if (branchId) await cacheDel(CacheKeys.branchById(branchId));
};
