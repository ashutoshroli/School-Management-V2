import dotenv from "dotenv";
dotenv.config({ path: "../.env" });

const nodeEnv = process.env.NODE_ENV || "development";

// SECURITY: fail fast instead of silently signing tokens with a guessable
// default secret. This only applies outside development so local setup
// without a .env file still works, but a real deployment can never
// accidentally run with "change-this-secret".
if (!process.env.JWT_SECRET && nodeEnv !== "development") {
  throw new Error(
    "JWT_SECRET environment variable must be set in non-development environments"
  );
}

export const config = {
  port: parseInt(process.env.PORT || "5000", 10),
  nodeEnv,
  jwt: {
    secret: process.env.JWT_SECRET || "change-this-secret",
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    callbackUrl: process.env.GOOGLE_CALLBACK_URL || "http://localhost:5000/api/auth/google/callback",
  },
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:3000",
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || "",
    keySecret: process.env.RAZORPAY_KEY_SECRET || "",
  },
  upload: {
    dir: process.env.UPLOAD_DIR || "./uploads",
    maxSize: parseInt(process.env.MAX_FILE_SIZE || "10485760", 10),
  },
};
