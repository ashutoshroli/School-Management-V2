import express from "express";
import cors from "cors";
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
app.use(
  cors({
    origin: config.frontendUrl,
    credentials: true,
  })
);

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
