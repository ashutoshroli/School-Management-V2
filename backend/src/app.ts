import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import passport from "./config/passport";
import routes from "./routes";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { config } from "./config";

const app = express();

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
app.use(express.json({ limit: "10mb" }));
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

// Static files (uploads)
app.use("/uploads", express.static(config.upload.dir));

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
