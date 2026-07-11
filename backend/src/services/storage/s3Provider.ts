import crypto from "crypto";
import path from "path";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../../config";
import { StorageProvider } from "../storage.service";
import { logger } from "../../config/logger";

/**
 * S3-backed storage provider (Phase 6). Works with real AWS S3 as well
 * as any S3-API-compatible service (Cloudflare R2, MinIO, DigitalOcean
 * Spaces, Backblaze B2) by setting S3_ENDPOINT - see config/index.ts's
 * `s3` block for every env var this reads.
 *
 * Only instantiated by storage.service.ts's getStorageProvider() when
 * STORAGE_PROVIDER=s3 - see that file for the LocalStorageProvider
 * fallback that's used otherwise (including whenever S3 config is
 * incomplete, so a misconfiguration fails closed to a working provider
 * rather than a crash).
 */
export class S3StorageProvider implements StorageProvider {
  private client: S3Client;
  private bucket: string;

  constructor() {
    this.bucket = config.s3.bucket;

    const clientConfig: S3ClientConfig = {
      region: config.s3.region,
      credentials: {
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey,
      },
    };
    if (config.s3.endpoint) {
      clientConfig.endpoint = config.s3.endpoint;
      // Most non-AWS S3-compatible services (MinIO, R2, etc) require
      // path-style addressing (https://endpoint/bucket/key) rather
      // than AWS's virtual-hosted-style (https://bucket.endpoint/key).
      clientConfig.forcePathStyle = true;
    }

    this.client = new S3Client(clientConfig);
  }

  private buildPublicUrl(key: string): string {
    if (config.s3.publicUrl) {
      return `${config.s3.publicUrl.replace(/\/$/, "")}/${key}`;
    }
    if (config.s3.endpoint) {
      return `${config.s3.endpoint.replace(/\/$/, "")}/${this.bucket}/${key}`;
    }
    return `https://${this.bucket}.s3.${config.s3.region}.amazonaws.com/${key}`;
  }

  /**
   * Recovers the S3 object key from a URL previously returned by
   * save() - needed by deleteByUrl()/readByUrl() since callers only
   * ever persist the URL (in StudentDocument.fileUrl etc), never the
   * raw key. Handles all three URL shapes buildPublicUrl() can produce.
   */
  private extractKey(url: string): string | null {
    try {
      const parsed = new URL(url);
      const pathname = parsed.pathname.replace(/^\//, "");
      // Path-style (custom endpoint or fallback AWS format): first path
      // segment is the bucket name, strip it.
      if (pathname.startsWith(`${this.bucket}/`)) {
        return pathname.slice(this.bucket.length + 1);
      }
      return pathname;
    } catch {
      return null;
    }
  }

  async save(buffer: Buffer, originalName: string, subDir: string): Promise<{ url: string }> {
    const ext = path.extname(originalName).toLowerCase().replace(/[^a-z0-9.]/g, "");
    const safeName = `${crypto.randomUUID()}${ext}`;
    const key = path.posix.join(subDir, safeName);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: guessContentType(ext),
      })
    );

    return { url: this.buildPublicUrl(key) };
  }

  async deleteByUrl(url: string): Promise<void> {
    const key = this.extractKey(url);
    if (!key) return;
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (error) {
      // Deletion is always best-effort in every caller of storage.ts
      // (e.g. upload.controller.ts's avatar-replace flow) - log and
      // swallow rather than let a delete failure surface as a 500 for
      // an otherwise-successful primary action.
      logger.warn("S3 delete failed (non-fatal)", { key, errorMessage: (error as Error).message });
    }
  }

  async readByUrl(url: string): Promise<Buffer | null> {
    const key = this.extractKey(url);
    if (!key) return null;
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const chunks: Buffer[] = [];
      // @ts-expect-error - Body is a Node.js Readable at runtime for the Node S3 client, though the SDK's cross-platform type is broader (web ReadableStream | Blob | Readable).
      for await (const chunk of result.Body) {
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } catch (error) {
      logger.warn("S3 read failed", { key, errorMessage: (error as Error).message });
      return null;
    }
  }

  /**
   * Generates a temporary signed URL for private-bucket setups where
   * buildPublicUrl()'s direct URL wouldn't actually be publicly
   * fetchable. Not part of the StorageProvider interface (the app
   * doesn't call this anywhere yet) - available for a future endpoint
   * that needs short-lived access to an otherwise-private object.
   */
  async getSignedDownloadUrl(url: string, expiresInSeconds = 3600): Promise<string | null> {
    const key = this.extractKey(url);
    if (!key) return null;
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }
}

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

function guessContentType(ext: string): string {
  return CONTENT_TYPES[ext] || "application/octet-stream";
}
