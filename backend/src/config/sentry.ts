import * as Sentry from "@sentry/node";
import { Application } from "express";
import { config } from "./index";
import { logger } from "./logger";

/**
 * Sentry error tracking (Phase 1 - Monitoring & Logging).
 *
 * Sentry is entirely OPT-IN via `SENTRY_DSN` (see .env.example) - if
 * it's unset (local dev, CI, or a deployment that hasn't set up a
 * Sentry project yet), the SDK itself no-ops every capture call
 * instead of throwing. This mirrors the pattern already used by every
 * notification provider in this repo (`isSmsConfigured()`,
 * `isEmailConfigured()`, etc) - a missing optional integration must
 * never crash the app or change behavior, only silently skip.
 *
 * IMPORTANT: `Sentry.init()` itself is called in `../instrument.ts`,
 * NOT here. That file is imported as the literal first line of
 * `server.ts`, before `express`/`cors`/anything else - Sentry's
 * OpenTelemetry-based auto-instrumentation can only correctly patch a
 * module (express, http, etc) if `Sentry.init()` ran before that
 * module was first required anywhere in the process. Calling
 * `Sentry.init()` here instead (as a previous version of this file
 * did) is too late: by the time any code in this file runs, app.ts's
 * own `import express from "express"` (and every other top-of-file
 * import) has already executed, since ES module imports are always
 * hoisted above the rest of a file's code. See instrument.ts's doc
 * comment for the full explanation + current Sentry docs reference.
 */

export const isSentryConfigured = (): boolean => Boolean(config.sentry.dsn);

/**
 * Registers Sentry's error handler. MUST be mounted after all routes
 * and BEFORE this app's own `errorHandler` (see app.ts) so Sentry sees
 * the original error, while the app's handler still owns building the
 * actual HTTP response.
 */
export const setupSentryErrorHandler = (app: Application): void => {
  if (!isSentryConfigured()) {
    logger.warn("Sentry is not configured (missing SENTRY_DSN) - error tracking is disabled");
    return;
  }
  Sentry.setupExpressErrorHandler(app);
  logger.info("Sentry error handler registered", { environment: config.nodeEnv });
};

/** Manually reports an error to Sentry (for errors caught outside Express's request/response cycle, e.g. in background jobs). */
export const captureException = (error: unknown, context?: Record<string, unknown>): void => {
  if (!isSentryConfigured()) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
};

export { Sentry };
