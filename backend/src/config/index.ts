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
    // Access token - short-lived (default 15 minutes)
    accessTokenExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
    // Refresh token - long-lived (default 7 days)
    refreshTokenExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
    // Optional separate secret for refresh tokens (recommended for production)
    refreshSecret: process.env.JWT_REFRESH_SECRET,
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    callbackUrl: process.env.GOOGLE_CALLBACK_URL || "http://localhost:5000/api/auth/google/callback",
  },
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:3000",
  // TEMPORARY - only used by the one-time POST /api/internal/bootstrap-admin
  // route (routes/bootstrapAdmin.routes.ts) to create the very first Super
  // Admin on a deployment whose DB isn't reachable from outside (e.g.
  // Render free-tier's internal-only Postgres connection string). Leave
  // unset to keep that route disabled (it fails closed with a 503 rather
  // than accepting an empty/missing header as a match - see the
  // controller). Remove this along with the rest of the bootstrap
  // endpoint once it's no longer needed.
  bootstrapSecret: process.env.BOOTSTRAP_SECRET || "",
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || "",
    keySecret: process.env.RAZORPAY_KEY_SECRET || "",
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || "",
  },
  upload: {
    dir: process.env.UPLOAD_DIR || "./uploads",
    maxSize: parseInt(process.env.MAX_FILE_SIZE || "10485760", 10),
  },
  s3: {
    // Optional cloud storage (Phase 6). Leave STORAGE_PROVIDER unset
    // (or "local") to keep using the local-disk provider - see
    // storage.service.ts's getStorageProvider(). Any S3-API-compatible
    // service works (AWS S3, Cloudflare R2, MinIO, DigitalOcean
    // Spaces, Backblaze B2) - set S3_ENDPOINT for anything that isn't
    // real AWS S3. For Cloudflare R2 specifically, prefer setting
    // STORAGE_PROVIDER=r2 and the dedicated R2_* variables below
    // instead - keeps R2 credentials from being mixed up with a
    // different S3-compatible provider's config.
    provider: process.env.STORAGE_PROVIDER || "local",
    bucket: process.env.S3_BUCKET || "",
    region: process.env.S3_REGION || "us-east-1",
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
    // Custom endpoint for S3-compatible providers other than AWS
    // itself; leave unset for real AWS S3.
    endpoint: process.env.S3_ENDPOINT || "",
    // Optional CDN/CloudFront domain to serve files from instead of
    // the raw bucket URL (e.g. "https://cdn.myschool.com"). Falls back
    // to the bucket's own public URL when unset.
    publicUrl: process.env.S3_PUBLIC_URL || "",
  },
  // Cloudflare R2 (S3-compatible object storage) - a dedicated,
  // R2-branded config block so its credentials are never confused
  // with the generic `s3` block above (which is meant for real AWS S3
  // or a different S3-compatible provider). Set
  // STORAGE_PROVIDER="r2" to use this - see storage.service.ts's
  // getStorageProvider() and config/r2.ts.
  r2: {
    accountId: process.env.R2_ACCOUNT_ID || "",
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    bucketName: process.env.R2_BUCKET_NAME || "",
    // The bucket's public R2.dev URL, or a connected custom domain
    // (e.g. "https://files.yourschool.com") - see the R2 dashboard's
    // bucket Settings > Public Access. Required for uploaded files to
    // actually be fetchable by a browser; without it, uploadToR2()
    // falls back to the (non-public) S3-API endpoint URL.
    publicUrl: process.env.R2_PUBLIC_URL || "",
    // Both of these are OPTIONAL - the S3 API endpoint for an R2
    // bucket is always `https://<accountId>.r2.cloudflarestorage.com`,
    // and R2 ignores the region value entirely (the AWS SDK just
    // requires one to be set) - config/r2.ts derives both
    // automatically from accountId/"auto" when left blank. Only set
    // these explicitly if you need to override the derived endpoint
    // (e.g. a jurisdiction-specific R2 endpoint) or want the region
    // value spelled out in your own .env for clarity.
    endpoint: process.env.R2_ENDPOINT || "",
    region: process.env.R2_REGION || "auto",
  },
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    fromName: process.env.SMTP_FROM_NAME || "School ERP",
    // Optional - the "From" display address, if it should be different
    // from the SMTP auth user (e.g. a shared relay account authenticating
    // as one address but sending "from" a different, nicer-looking one).
    // Falls back to SMTP_USER when unset, matching the previous
    // (SMTP_USER-only) behavior - see emailProvider.ts's sendEmail().
    fromEmail: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || "",
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
  redis: {
    // Optional caching layer (Phase 4). Leave unset to disable entirely
    // - see config/redis.ts's isRedisConfigured()/cache.service.ts,
    // which fall back to always-miss (i.e. hit the database directly,
    // today's behavior) when this is blank. Matches
    // docker-compose.yml's Redis service for local development
    // (redis://localhost:6379).
    url: process.env.REDIS_URL || "",
  },
};
