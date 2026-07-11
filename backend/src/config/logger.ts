import winston from "winston";
import { config } from "./index";

/**
 * Centralized structured logger (Phase 1 - Monitoring & Logging).
 *
 * Replaces ad-hoc `console.log`/`console.error` calls across the
 * backend with structured, leveled logs that:
 *   - Print human-readable colorized output in development.
 *   - Print single-line JSON in production/test, so log lines are easy
 *     to ship to any log aggregator (CloudWatch, Loggly, Datadog, etc)
 *     that expects JSON - this repo doesn't mandate a specific
 *     aggregator, just a consistent machine-parseable format.
 *
 * `LOG_LEVEL` (see .env.example) controls verbosity - defaults to
 * "debug" in development and "info" everywhere else, matching
 * Winston's standard level ordering (error < warn < info < http <
 * verbose < debug < silly).
 */

const isProduction = config.nodeEnv === "production";
const isTest = config.nodeEnv === "test";

const level = process.env.LOG_LEVEL || (config.nodeEnv === "development" ? "debug" : "info");

const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const devFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: "HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level: lvl, message, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    return `${timestamp} [${lvl}] ${stack || message}${metaStr}`;
  })
);

export const logger = winston.createLogger({
  level,
  format: config.nodeEnv === "development" ? devFormat : jsonFormat,
  transports: [
    new winston.transports.Console({
      // Tests intentionally run "silent" by default so `npm test` output
      // isn't drowned in log lines - individual tests can still assert
      // against `logger` by mocking it, since it's a normal Winston
      // instance.
      silent: isTest && process.env.LOG_IN_TESTS !== "true",
    }),
  ],
  // Never let a logging failure crash the process.
  exitOnError: false,
});

/**
 * Convenience helper for logging a caught error with consistent shape
 * (message + stack + optional context). Prefer this over
 * `logger.error(err)` directly so every error log has a searchable
 * `message` field even when `err` isn't an Error instance.
 */
export const logError = (message: string, error: unknown, meta: Record<string, unknown> = {}): void => {
  const errorMeta =
    error instanceof Error
      ? { errorMessage: error.message, stack: error.stack }
      : { errorMessage: String(error) };
  logger.error(message, { ...errorMeta, ...meta });
};

export default logger;
