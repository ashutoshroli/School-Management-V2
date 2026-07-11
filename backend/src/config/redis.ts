import Redis from "ioredis";
import { config } from "./index";
import { logger } from "./logger";

/**
 * Redis client (Phase 4 - Caching layer).
 *
 * Entirely OPT-IN via `REDIS_URL` (see .env.example / docker-compose.yml)
 * - matches the pattern every other optional integration in this repo
 * follows (Sentry, SMS/WhatsApp/Push providers): a missing/unset
 * integration must never crash the app, only silently disable itself.
 * cache.service.ts checks `isRedisConfigured()` before every operation
 * and falls back to "always miss" (i.e. callers hit the database
 * directly, exactly like before this phase) when Redis isn't set up.
 */

export const isRedisConfigured = (): boolean => Boolean(config.redis.url);

let client: Redis | null = null;
// Tracks whether we've already logged a connection failure, so a
// Redis outage doesn't spam the logs with one "connection failed" line
// per cache miss (which, at cache-miss-rate request volume, would be
// a lot) - callers still safely fall through to the database on every
// failed cache operation regardless.
let hasLoggedConnectionError = false;

export const getRedisClient = (): Redis | null => {
  if (!isRedisConfigured()) return null;

  if (!client) {
    client = new Redis(config.redis.url, {
      // Cap retry attempts instead of ioredis's default of retrying
      // forever - if Redis is genuinely down, callers should fall back
      // to the database (see cache.service.ts) rather than piling up
      // a growing queue of commands waiting on a dead connection.
      maxRetriesPerRequest: 2,
      retryStrategy: (times) => (times > 5 ? null : Math.min(times * 200, 2000)),
      lazyConnect: false,
    });

    client.on("error", (err) => {
      if (!hasLoggedConnectionError) {
        logger.warn("Redis connection error - caching disabled until it recovers", { errorMessage: err.message });
        hasLoggedConnectionError = true;
      }
    });

    client.on("connect", () => {
      hasLoggedConnectionError = false;
      logger.info("Redis connected");
    });
  }

  return client;
};

/** Test-only: allows tests to reset the module-level singleton between cases. */
export const __resetRedisClientForTests = (): void => {
  client = null;
  hasLoggedConnectionError = false;
};
