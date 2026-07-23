import express from "express";
import cors, { CorsOptionsDelegate } from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import swaggerUi from "swagger-ui-express";
import passport from "./config/passport";
import routes from "./routes";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { requestId } from "./middleware/requestId";
import { config } from "./config";
import { setupSentryErrorHandler } from "./config/sentry";
import { swaggerSpec, isDocsEnabled } from "./docs/swagger";

const app = express();

// Request ID tracking (for log correlation + debugging)
app.use(requestId);

// Security middleware
app.use(helmet());

// CORS.
//
// PREVIOUSLY this was two separate `app.use(cors(...))` calls: a
// permissive one scoped to 3 paths via `app.use(path, middleware)`,
// mounted before a second, app-wide `app.use(cors({ origin:
// config.frontendUrl }))` with no path restriction. That was broken for
// real (non-OPTIONS) requests: `app.use(path, fn)` matches ALL methods
// under that path, so BOTH cors() instances ran in the chain for a POST
// to e.g. /api/facilities/attendance-devices - the scoped one set
// Access-Control-Allow-Origin to the reflected origin and called next(),
// then the app-wide one (having no path restriction) ran right after it
// and OVERWROTE that header with config.frontendUrl. OPTIONS preflight
// didn't show this bug because the `cors` package answers OPTIONS itself
// (res.end(), preflightContinue defaults to false) and never calls
// next() - so for OPTIONS only the first (scoped) instance ever ran.
//
// FIX: a single cors() middleware, using the package's per-request
// "options delegate" function form (see https://github.com/expressjs/cors#configuring-cors-asynchronously)
// instead of a static options object. It inspects req.path once per
// request and returns a different, complete options object depending on
// whether the request is for one of the 3 device-facing routes or not.
// Since there is now only one cors() instance in the middleware chain,
// there is nothing after it that can overwrite the header it sets - the
// bug above cannot recur by construction.
const DEVICE_CORS_PATHS = [
  "/api/facilities/attendance-devices",
  "/api/academics/attendance/card-tap",
  "/api/hr/attendance/card-tap",
];

const isDeviceCorsPath = (path: string): boolean =>
  DEVICE_CORS_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

const corsOptionsDelegate: CorsOptionsDelegate = (req, callback) => {
  if (isDeviceCorsPath((req as express.Request).path)) {
    // These 3 routes are called by external, non-browser-frontend tools
    // (a standalone HTML console, a Termux/curl-based reader simulator,
    // an actual RFID reader's firmware) that are never served from
    // `config.frontendUrl` - including pages opened as a local `file://`
    // (which sends `Origin: null`). `origin: true` reflects whatever
    // Origin the request sent, including null. `credentials` is left
    // false - device registration authenticates via a `Bearer` JWT
    // (an `Authorization` header, not a cookie) and card-tap via the
    // `X-Device-Api-Key` header, so no cookie-based/credentialed CORS
    // mode is needed here, and not enabling it avoids any risk of
    // introducing cross-site cookie use on these public paths.
    callback(null, {
      origin: true,
      credentials: false,
      methods: ["POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Device-Api-Key"],
    });
    return;
  }

  // Unchanged behavior for every other route.
  callback(null, {
    origin: config.frontendUrl,
    credentials: true,
  });
};

app.use(cors(corsOptionsDelegate));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { success: false, message: "Too many requests, please try again later" },
});
app.use("/api/auth", limiter);

// Body parsing
// The `verify` hook stashes the raw request body on `req.rawBody` before
// it's parsed to JSON - the Razorpay webhook handler needs the exact raw
// bytes to compute/verify the HMAC signature; re-serializing the parsed
// JSON would not reliably reproduce the original byte sequence.
app.use(
  express.json({
    limit: "10mb",
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Logging
if (config.nodeEnv === "development") {
  app.use(morgan("dev"));
}

// Passport
app.use(passport.initialize());

// API routes
app.use("/api", routes);

// API documentation (Phase 6) - GET /api/docs (Swagger UI) and
// GET /api/docs.json (raw OpenAPI spec, e.g. for importing into
// Postman/Insomnia). Disabled in production by default - see
// docs/swagger.ts's isDocsEnabled().
if (isDocsEnabled()) {
  app.get("/api/docs.json", (_req, res) => res.json(swaggerSpec));
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

// Static files (uploads)
app.use("/uploads", express.static(config.upload.dir));

// Error handling
app.use(notFoundHandler);
// Sentry's error handler must be registered AFTER routes/notFoundHandler
// but BEFORE this app's own errorHandler, so Sentry captures the error
// while this app's handler still owns building the actual HTTP response.
setupSentryErrorHandler(app);
app.use(errorHandler);

export default app;
