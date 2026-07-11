import app from "./app";
import { config } from "./config";
import { logger } from "./config/logger";

const PORT = config.port;

app.listen(PORT, () => {
  logger.info("School ERP Backend Server started", {
    environment: config.nodeEnv,
    port: PORT,
    api: `http://localhost:${PORT}/api`,
    health: `http://localhost:${PORT}/api/health`,
  });
});

// Surface otherwise-unhandled failures (e.g. a Promise rejection deep in
// a fire-and-forget notification/background task) in logs + Sentry
// instead of letting them disappear silently or crash the process
// without any record of why.
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", { reason: reason instanceof Error ? reason.message : String(reason) });
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", { errorMessage: error.message, stack: error.stack });
});
