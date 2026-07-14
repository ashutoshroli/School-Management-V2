import crypto from "crypto";
import path from "path";
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { config } from "./index";
import { logger } from "./logger";

/**
 * Cloudflare R2 client setup (S3-compatible object storage).
 *
 * R2 speaks the S3 API, so this reuses `@aws-sdk/client-s3` (already a
 * dependency - see services/storage/s3Provider.ts, which serves the
 * same purpose for real AWS S3/other S3-compatible providers like
 * MinIO/Backblaze). This file is a dedicated, R2-branded entry point
 * with its own env vars (`R2_*`) so R2 credentials are never mixed up
 * with the generic `S3_*` config meant for a different provider - see
 * .env.example.
 *
 * The client is only constructed lazily, on first use - matches every
 * other optional integration in this codebase (Redis, Sentry,
 * SMS/WhatsApp/Push providers): a missing/unset integration must never
 * crash the app at import time.
 */

export const isR2Configured = (): boolean =>
  Boolean(config.r2.accountId && config.r2.accessKeyId && config.r2.secretAccessKey && config.r2.bucketName);

let client: S3Client | null = null;

/**
 * The S3-API endpoint for this R2 account. R2_ENDPOINT is optional -
 * every R2 bucket's endpoint follows the exact same
 * `https://<accountId>.r2.cloudflarestorage.com` pattern, so this is
 * derived automatically from R2_ACCOUNT_ID whenever R2_ENDPOINT isn't
 * explicitly set (matches how config.r2.endpoint/region are wired in
 * config/index.ts).
 */
const resolveR2Endpoint = (): string =>
  config.r2.endpoint || `https://${config.r2.accountId}.r2.cloudflarestorage.com`;

/** Lazily constructs (and caches) the R2 S3Client - never instantiated unless an R2 upload/delete is actually called. */
export const getR2Client = (): S3Client => {
  if (!client) {
    client = new S3Client({
      region: config.r2.region || "auto", // R2 ignores the region value, but the AWS SDK requires one to be set.
      endpoint: resolveR2Endpoint(),
      credentials: {
        accessKeyId: config.r2.accessKeyId,
        secretAccessKey: config.r2.secretAccessKey,
      },
      // R2 (like every other non-AWS S3-compatible endpoint) requires
      // path-style addressing (https://endpoint/bucket/key) rather than
      // AWS's virtual-hosted-style (https://bucket.endpoint/key) - see
      // s3Provider.ts's identical comment for the generic-S3 provider.
      forcePathStyle: true,
    });
  }
  return client;
};

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv",
};

const guessContentType = (fileName: string): string => {
  const ext = path.extname(fileName).toLowerCase();
  return CONTENT_TYPES[ext] || "application/octet-stream";
};

const buildPublicUrl = (key: string): string => {
  if (config.r2.publicUrl) {
    return `${config.r2.publicUrl.replace(/\/$/, "")}/${key}`;
  }
  // Fallback when R2_PUBLIC_URL isn't set - this points at the private
  // S3-API endpoint itself, which is NOT publicly browsable unless the
  // bucket's public-access setting is on. R2_PUBLIC_URL (the bucket's
  // R2.dev URL or a connected custom domain) should always be set in
  // practice - see .env.example.
  return `${resolveR2Endpoint()}/${config.r2.bucketName}/${key}`;
};

/** Recovers the R2 object key from a URL previously returned by uploadToR2(), or passes through an already-raw key unchanged. */
const extractR2Key = (urlOrKey: string): string | null => {
  if (!/^https?:\/\//i.test(urlOrKey)) return urlOrKey;
  try {
    const parsed = new URL(urlOrKey);
    const pathname = parsed.pathname.replace(/^\//, "");
    if (pathname.startsWith(`${config.r2.bucketName}/`)) {
      return pathname.slice(config.r2.bucketName.length + 1);
    }
    return pathname;
  } catch {
    return null;
  }
};

/**
 * Uploads a file buffer to the configured R2 bucket and returns its
 * public URL (and raw object key, for callers that need it directly).
 *
 * Reusable across every upload flow (student/staff documents, avatars,
 * exam question papers, templates, certificates) - in practice,
 * callers should go through storage.service.ts's `storage.save()`
 * instead of calling this directly, so the actual provider stays
 * swappable (local disk / generic S3 / R2) via `STORAGE_PROVIDER`,
 * exactly like every other storage call in this codebase already
 * does. This function is what backs `storage.save()` when
 * `STORAGE_PROVIDER=r2` - see services/storage/r2Provider.ts and
 * services/storage.service.ts's `getStorageProvider()`.
 *
 * @param fileBuffer - raw file bytes (from multer's memoryStorage - `req.file.buffer`)
 * @param fileName - original filename, used only to preserve the extension - NEVER trusted for the actual object key (a random UUID is used instead, avoiding both path-traversal and filename collisions)
 * @param mimeType - optional explicit MIME type (e.g. `req.file.mimetype`); guessed from the file extension if omitted
 * @param subDir - optional folder prefix within the bucket (e.g. "students/<id>"), matching every other storage provider's `subDir` convention
 */
export const uploadToR2 = async (
  fileBuffer: Buffer,
  fileName: string,
  mimeType?: string,
  subDir = "uploads"
): Promise<{ url: string; key: string }> => {
  const ext = path.extname(fileName).toLowerCase().replace(/[^a-z0-9.]/g, "");
  const safeName = `${crypto.randomUUID()}${ext}`;
  const key = path.posix.join(subDir, safeName);

  // A single PutObjectCommand call (same pattern as the existing
  // s3Provider.ts) is sufficient here - S3/R2's PutObject supports
  // objects up to 5GB in one request, well above this app's
  // MAX_FILE_SIZE cap (10MB by default, see config/index.ts's
  // upload.maxSize), so there's no real multipart-upload need to
  // justify the extra @aws-sdk/lib-storage dependency.
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: config.r2.bucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: mimeType || guessContentType(fileName),
    })
  );

  return { url: buildPublicUrl(key), key };
};

/**
 * Deletes a previously-uploaded object from R2, given either the full
 * public URL returned by uploadToR2() or a raw object key. Never
 * throws - deletion is always best-effort (matches every other
 * storage provider's deleteByUrl() in this codebase), so a delete
 * failure never blocks whatever primary action (record delete,
 * file replace, etc) triggered it.
 */
export const deleteFromR2 = async (urlOrKey: string): Promise<void> => {
  if (!isR2Configured()) return;
  const key = extractR2Key(urlOrKey);
  if (!key) return;
  try {
    await getR2Client().send(new DeleteObjectCommand({ Bucket: config.r2.bucketName, Key: key }));
  } catch (error) {
    logger.warn("R2 delete failed (non-fatal)", { key, errorMessage: (error as Error).message });
  }
};

/**
 * Reads back a previously-uploaded object's raw bytes, given either
 * the full public URL returned by uploadToR2() or a raw object key.
 * Needed by templateRenderer.service.ts to load an uploaded DOCX
 * template's contents server-side before filling in placeholders -
 * unlike every other use of R2 storage so far (write-once, serve via
 * the bucket's public URL), template *generation* needs the actual
 * bytes, not just a URL. Returns null if the object doesn't exist or
 * the URL/key can't be resolved.
 */
export const readFromR2 = async (urlOrKey: string): Promise<Buffer | null> => {
  const key = extractR2Key(urlOrKey);
  if (!key) return null;
  try {
    const result = await getR2Client().send(new GetObjectCommand({ Bucket: config.r2.bucketName, Key: key }));
    const chunks: Buffer[] = [];
    // @ts-expect-error - Body is a Node.js Readable at runtime for the Node S3 client, though the SDK's cross-platform type is broader (web ReadableStream | Blob | Readable) - same caveat as s3Provider.ts's readByUrl().
    for await (const chunk of result.Body) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch (error) {
    logger.warn("R2 read failed", { key, errorMessage: (error as Error).message });
    return null;
  }
};

/** Test-only: resets the module-level client singleton between test cases. */
export const __resetR2ClientForTests = (): void => {
  client = null;
};
