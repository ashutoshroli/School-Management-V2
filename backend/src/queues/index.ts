import Bull, { Queue, JobOptions } from "bull";
import { config } from "../config";
import { isRedisConfigured } from "../config/redis";
import { logger } from "../config/logger";

/**
 * Background job queues (Phase 5).
 *
 * Entirely OPT-IN via `REDIS_URL` (Bull requires a real Redis instance
 * - there's no in-memory fallback the way cache.service.ts has one).
 * When Redis isn't configured, `getQueue()` returns null and every
 * caller (see queues/*.queue.ts) falls back to running the same work
 * INLINE/synchronously instead - i.e. exactly today's (pre-Phase-5)
 * behavior. This means:
 *   - A deployment with no Redis still works end-to-end, it just has
 *     no protection against a large bulk operation taking a long time
 *     within a single request (today's status quo).
 *   - Once REDIS_URL is set, the same endpoints return immediately
 *     with a jobId and do the actual work on a worker process instead.
 *
 * Queues are deliberately NOT auto-processed in the API server process
 * itself (no `.process()` call here) - see workers/ for the separate
 * worker entrypoint. Running queue processing inside the same process
 * that serves HTTP requests would defeat the entire point (a slow job
 * would still block the event loop / compete for the same resources);
 * a real deployment runs `node dist/workers/index.js` as its own
 * process/container alongside the API server.
 */

const queues = new Map<string, Queue>();

export const QUEUE_NAMES = {
  NOTIFICATIONS: "notifications",
  REPORTS: "reports",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

const DEFAULT_JOB_OPTIONS: JobOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5000 },
  // Keep a bounded amount of job history instead of Bull's default of
  // keeping everything forever - this repo's jobs run frequently
  // enough (daily fee reminders, ad-hoc report requests) that an
  // unbounded history would grow the Redis keyspace indefinitely.
  removeOnComplete: 100,
  removeOnFail: 500,
};

/** Returns the named queue, lazily creating it on first use, or null if Redis isn't configured. */
export const getQueue = (name: QueueName): Queue | null => {
  if (!isRedisConfigured()) return null;

  let queue = queues.get(name);
  if (!queue) {
    queue = new Bull(name, config.redis.url, { defaultJobOptions: DEFAULT_JOB_OPTIONS });
    queue.on("error", (err) => {
      logger.warn(`Queue "${name}" connection error`, { errorMessage: err.message });
    });
    queues.set(name, queue);
  }
  return queue;
};

/** Test-only: allows tests to reset the module-level queue cache between cases. */
export const __resetQueuesForTests = (): void => {
  queues.clear();
};

/** Gracefully closes every open queue connection - call on process shutdown. */
export const closeAllQueues = async (): Promise<void> => {
  await Promise.all(Array.from(queues.values()).map((q) => q.close()));
  queues.clear();
};
