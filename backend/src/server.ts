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
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", { errorMessage: error.message, stack: error.stack });
  gracefulShutdown("uncaughtException");
});
