import * as Sentry from "@sentry/node";
import { Application } from "express";
import { config } from "./index";
import { logger } from "./logger";

/**
 * Sentry error tracking (Phase 1 - Monitoring & Logging).
 *
 * Sentry is entirely OPT-IN via `SENTRY_DSN` (see .env.example) - if
 * it's unset (local dev, CI, or a deployment that hasn't set up a
 * Sentry project yet), `initSentry()` is a no-op and the app behaves
 * exactly as before this phase. This mirrors the pattern already used
 * by every notification provider in this repo (`isSmsConfigured()`,
 * `isEmailConfigured()`, etc) - a missing optional integration must
 * never crash the app or change behavior, only silently skip.
 */

export const isSentryConfigured = (): boolean => Boolean(config.sentry.dsn);

export const initSentry = (app: Application): void => {
  if (!isSentryConfigured()) {
    logger.warn("Sentry is not configured (missing SENTRY_DSN) - error tracking is disabled");
    return;
  }

  Sentry.init({
    dsn: config.sentry.dsn,
    environment: config.nodeEnv,
    // Modest default trace sample rate - full tracing on every request
    // is unnecessary cost for a school ERP's traffic profile and can be
    // raised per-deployment via SENTRY_TRACES_SAMPLE_RATE if desired.
    tracesSampleRate: config.sentry.tracesSampleRate,
  });

  // Sentry v8's Express integration auto-instruments request handling
  // via `Sentry.init`'s `integrations` when `app` is passed through
  // `setupExpressErrorHandler` below - no separate request-handler
  // middleware needed in this version, unlike Sentry v7.
  void app; // app is accepted for API-compatibility / future explicit wiring, not otherwise used here.

  logger.info("Sentry error tracking initialized", { environment: config.nodeEnv });
};

/**
 * Registers Sentry's error handler. MUST be mounted after all routes
 * and BEFORE this app's own `errorHandler` (see app.ts) so Sentry sees
 * the original error, while the app's handler still owns building the
 * actual HTTP response.
 */
export const setupSentryErrorHandler = (app: Application): void => {
  if (!isSentryConfigured()) return;
  Sentry.setupExpressErrorHandler(app);
};

/** Manually reports an error to Sentry (for errors caught outside Express's request/response cycle, e.g. in background jobs). */
export const captureException = (error: unknown, context?: Record<string, unknown>): void => {
  if (!isSentryConfigured()) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
};

export { Sentry };
