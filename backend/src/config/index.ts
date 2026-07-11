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
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || "",
  },
  upload: {
    dir: process.env.UPLOAD_DIR || "./uploads",
    maxSize: parseInt(process.env.MAX_FILE_SIZE || "10485760", 10),
  },
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    fromName: process.env.SMTP_FROM_NAME || "School ERP",
  },
  sms: {
    // MSG91 Flow API (https://docs.msg91.com/reference/send-otp) - the
    // "authkey" is the account-level API key, `templateId` is the DLT-
    // registered flow/template ID for the fee-reminder/generic message.
    // If templateId is unset, we fall back to MSG91's simpler legacy
    // /api/v5/otp or plain-SMS style endpoint (see smsProvider.ts).
    provider: process.env.SMS_PROVIDER || "msg91",
    apiKey: process.env.SMS_API_KEY || "",
    senderId: process.env.SMS_SENDER_ID || "SCHLRP",
    templateId: process.env.SMS_TEMPLATE_ID || "",
    route: process.env.SMS_ROUTE || "4", // MSG91 transactional route
  },
  whatsapp: {
    // Interakt (https://www.interakt.shop/) by default - `apiUrl`
    // defaults to their public API base if unset.
    apiKey: process.env.WHATSAPP_API_KEY || "",
    apiUrl: process.env.WHATSAPP_API_URL || "https://api.interakt.ai/v1/public",
  },
  push: {
    // Firebase Cloud Messaging (HTTP v1 API) - requires a service
    // account. FCM_PROJECT_ID + FCM_CLIENT_EMAIL + FCM_PRIVATE_KEY come
    // straight from the downloaded service-account JSON.
    projectId: process.env.FCM_PROJECT_ID || "",
    clientEmail: process.env.FCM_CLIENT_EMAIL || "",
    // Service account private keys are PEM blocks with literal newlines,
    // which don't survive .env files well - convention is to store them
    // with "\n" escapes and unescape at load time.
    privateKey: (process.env.FCM_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  },
  sentry: {
    // Optional error tracking (Phase 1 - Monitoring). Leave unset to
    // disable entirely - see config/sentry.ts's isSentryConfigured().
    dsn: process.env.SENTRY_DSN || "",
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || "0.1"),
  },
};
