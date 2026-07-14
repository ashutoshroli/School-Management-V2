import dotenv from "dotenv";
// Same relative path as config/index.ts's own dotenv.config() call -
// dotenv resolves `path` relative to process.cwd() (NOT this file's
// location), which is `backend/` for every way this app is actually
// run (npm scripts, Dockerfile's `cd backend && node dist/server.js`),
// so "../.env" resolves to the repo root's .env file. On Render, real
// env vars are injected directly into process.env and no .env file
// exists at all - dotenv.config() silently no-ops in that case, it
// never throws just because the file is missing.
dotenv.config({ path: "../.env" });

import * as Sentry from "@sentry/node";

/**
 * Sentry bootstrap - MUST be the very first thing this app's real
 * entry point (server.ts) imports, before anything else (express,
 * cors, the Prisma client, etc).
 *
 * Why a separate file instead of just writing `Sentry.init()` at the
 * top of server.ts/app.ts: TypeScript/ES module `import` statements
 * are always hoisted above any other code in the same file, so even
 * code physically written at the very top of a file still runs AFTER
 * every import in that file has already been loaded. Sentry's
 * OpenTelemetry-based auto-instrumentation (for express/http/etc) can
 * only correctly patch a module if Sentry.init() ran before that
 * module was first required anywhere in the process - so the only
 * reliable way to guarantee "Sentry first" is a dedicated file like
 * this one, loaded via a bare `import "./instrument";` as the literal
 * first line of server.ts (see current Sentry docs:
 * https://docs.sentry.io/platforms/javascript/guides/express/install/commonjs/).
 *
 * Sentry is entirely OPT-IN via SENTRY_DSN (see .env.example) - when
 * it's unset (local dev, CI, or a deployment that hasn't created a
 * Sentry project yet), the SDK itself no-ops every capture call
 * instead of throwing, so this is always safe to call unconditionally.
 */
if (!process.env.SENTRY_DSN) {
  // eslint-disable-next-line no-console
  console.warn("[sentry] SENTRY_DSN is not set - error tracking is disabled for this process");
}

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || "0.1"),
});
