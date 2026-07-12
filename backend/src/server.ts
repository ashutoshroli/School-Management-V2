import app from "./app";
import { config } from "./config";
import { logger } from "./config/logger";

const PORT = config.port;

const server = app.listen(PORT, () => {
  logger.info("School ERP Backend Server started", {
    environment: config.nodeEnv,
    port: PORT,
    api: `http://localhost:${PORT}/api`,
    health: `http://localhost:${PORT}/api/health`,
  });
});

// ===== GRACEFUL SHUTDOWN =====
// On SIGTERM/SIGINT (e.g. Docker stop, Ctrl+C, PaaS deploy), stop
// accepting new connections and wait for in-flight requests to complete
// before exiting. This prevents 502s during rolling deployments and
// ensures background tasks (Bull jobs, notification sends) have a
// chance to finish their current work before the process dies.
const SHUTDOWN_TIMEOUT_MS = 30_000; // 30 seconds max wait

const gracefulShutdown = (signal: string) => {
  logger.info(`${signal} received - starting graceful shutdown`);

  // Stop accepting new connections
  server.close(() => {
    logger.info("HTTP server closed - all in-flight requests completed");
    process.exit(0);
  });

  // Force exit if in-flight requests don't finish in time
  setTimeout(() => {
    logger.warn("Graceful shutdown timed out - forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Surface otherwise-unhandled failures (e.g. a Promise rejection deep in
// a fire-and-forget notification/background task) in logs + Sentry
// instead of letting them disappear silently or crash the process
// without any record of why.
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", { reason: reason instanceof Error ? reason.message : String(reason) });
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", { errorMessage: error.message, stack: error.stack });
  // Unlike unhandledRejection, uncaughtException leaves the process in
  // an undefined state - exit after logging so it can be restarted.
  gracefulShutdown("uncaughtException");
});
