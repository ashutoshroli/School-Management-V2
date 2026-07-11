import fs from "fs";
import path from "path";
import crypto from "crypto";
import { config } from "../config";

/**
 * Minimal storage abstraction so the rest of the app (upload.controller.ts)
 * never talks to the filesystem directly. Only a local-disk implementation
 * exists today (matches the already-scaffolded UPLOAD_DIR/MAX_FILE_SIZE
 * config and app.ts's `express.static(config.upload.dir)` mount at
 * `/uploads`), but swapping in an S3/GCS-backed provider later only
 * means implementing this interface and changing the export at the
 * bottom of this file - no controller changes needed.
 */
export interface StorageProvider {
  /** Saves a file buffer under `subDir` and returns its public URL. */
  save(buffer: Buffer, originalName: string, subDir: string): Promise<{ url: string }>;
  /** Deletes a previously-saved file, given the URL returned by save(). */
  deleteByUrl(url: string): Promise<void>;
  /**
   * Reads back a previously-saved file's bytes, given the URL returned
   * by save(). Needed by templateRenderer.service.ts to load an
   * uploaded DOCX template's contents before filling in placeholders -
   * unlike every other use of storage so far (write-once, serve via
   * static file mount), template *generation* needs the raw bytes
   * server-side, not just a public URL to redirect a browser to.
   * Returns null if the file doesn't exist.
   */
  readByUrl(url: string): Promise<Buffer | null>;
}

const UPLOADS_URL_PREFIX = "/uploads/";

class LocalStorageProvider implements StorageProvider {
  async save(buffer: Buffer, originalName: string, subDir: string): Promise<{ url: string }> {
    // Never trust the client-supplied filename for the on-disk name -
    // only use it to preserve the extension. A random UUID avoids both
    // path traversal (e.g. "../../etc/passwd") and filename collisions.
    const ext = path.extname(originalName).toLowerCase().replace(/[^a-z0-9.]/g, "");
    const safeName = `${crypto.randomUUID()}${ext}`;

    const dir = path.join(config.upload.dir, subDir);
    fs.mkdirSync(dir, { recursive: true });

    const fullPath = path.join(dir, safeName);
    fs.writeFileSync(fullPath, buffer);

    const relativePath = path.posix.join(subDir, safeName);
    return { url: `${UPLOADS_URL_PREFIX}${relativePath}` };
  }

  async deleteByUrl(url: string): Promise<void> {
    if (!url.startsWith(UPLOADS_URL_PREFIX)) return;
    const relativePath = url.slice(UPLOADS_URL_PREFIX.length);
    const fullPath = path.join(config.upload.dir, relativePath);
    // Guard against the resolved path escaping the upload directory
    // (defense in depth on top of the sanitized filename above).
    const resolvedUploadDir = path.resolve(config.upload.dir);
    const resolvedTarget = path.resolve(fullPath);
    if (!resolvedTarget.startsWith(resolvedUploadDir)) return;
    if (fs.existsSync(resolvedTarget)) {
      fs.unlinkSync(resolvedTarget);
    }
  }

  async readByUrl(url: string): Promise<Buffer | null> {
    if (!url.startsWith(UPLOADS_URL_PREFIX)) return null;
    const relativePath = url.slice(UPLOADS_URL_PREFIX.length);
    const fullPath = path.join(config.upload.dir, relativePath);
    const resolvedUploadDir = path.resolve(config.upload.dir);
    const resolvedTarget = path.resolve(fullPath);
    if (!resolvedTarget.startsWith(resolvedUploadDir)) return null;
    if (!fs.existsSync(resolvedTarget)) return null;
    return fs.readFileSync(resolvedTarget);
  }
}

export const storage: StorageProvider = new LocalStorageProvider();
