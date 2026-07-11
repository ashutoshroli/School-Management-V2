/**
 * Standalone worker process entrypoint (Phase 5 - Background Jobs).
 *
 * Run this as its OWN process/container, separate from the API server
 * (`node dist/server.js`) - e.g. `node dist/workers/index.js`, or as a
 * second service in docker-compose.yml / a second Render/Railway
 * service pointed at the same REDIS_URL and DATABASE_URL. It has no
 * HTTP server of its own; it just connects to Redis and processes
 * whatever jobs queues/*.queue.ts producers enqueue.
 *
 * If REDIS_URL isn't set, this process logs a warning and exits
 * immediately (nothing to do - see queues/index.ts's header comment
 * for why callers fall back to inline/synchronous execution in that
 * case instead of relying on a worker that will never run).
 */
import { config } from "../config";
import { isRedisConfigured } from "../config/redis";
import { logger } from "../config/logger";
import { startNotificationWorker } from "./notificationWorker";
import { startReportWorker } from "./reportWorker";

if (!isRedisConfigured()) {
  logger.warn("Worker process exiting: REDIS_URL is not configured, there are no queues to process");
  process.exit(0);
}

startNotificationWorker();
startReportWorker();

logger.info("Worker process ready", { environment: config.nodeEnv });

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection in worker process", {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception in worker process", { errorMessage: error.message, stack: error.stack });
});
