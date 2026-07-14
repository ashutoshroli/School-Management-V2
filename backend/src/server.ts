// MUST be the very first import in this file - see instrument.ts's
// doc comment for why Sentry.init() has to run before app.ts (and
// therefore before express/cors/etc) is ever imported.
import "./instrument";

import app from "./app";
import { config } from "./config";
import { logger } from "./config/logger";
import { captureException } from "./config/sentry";

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
const SHUTDOWN_TIMEOUT_MS = 30_000;

const gracefulShutdown = (signal: string) => {
  logger.info(`${signal} received - starting graceful shutdown`);
  server.close(() => {
    logger.info("HTTP server closed - all in-flight requests completed");
    process.exit(0);
  });
  setTimeout(() => {
    logger.warn("Graceful shutdown timed out - forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", { reason: reason instanceof Error ? reason.message : String(reason) });
  captureException(reason);
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", { errorMessage: error.message, stack: error.stack });
  captureException(error);
  gracefulShutdown("uncaughtException");
});
