import { StorageProvider } from "../storage.service";
import { uploadToR2, deleteFromR2, readFromR2, isR2Configured } from "../../config/r2";

/**
 * Cloudflare R2-backed storage provider. Wires the reusable
 * uploadToR2()/deleteFromR2() helpers (config/r2.ts) into the
 * StorageProvider interface every controller already talks to via
 * storage.service.ts's `storage` export - so switching
 * STORAGE_PROVIDER to "r2" moves every existing upload flow (student/
 * staff documents, avatars, exam question papers, templates,
 * certificates) onto R2 with zero controller changes.
 *
 * Only instantiated by storage.service.ts's getStorageProvider() when
 * STORAGE_PROVIDER=r2 - see that file for the LocalStorageProvider
 * fallback used otherwise (including whenever R2 config is
 * incomplete, so a misconfiguration fails closed to a working
 * provider instead of crashing on every file operation).
 */
export class R2StorageProvider implements StorageProvider {
  async save(buffer: Buffer, originalName: string, subDir: string): Promise<{ url: string }> {
    const { url } = await uploadToR2(buffer, originalName, undefined, subDir);
    return { url };
  }

  async deleteByUrl(url: string): Promise<void> {
    await deleteFromR2(url);
  }

  /**
   * Needed by templateRenderer.service.ts to load an uploaded DOCX
   * template's raw bytes server-side before filling in placeholders -
   * see config/r2.ts's readFromR2() for details.
   */
  async readByUrl(url: string): Promise<Buffer | null> {
    return readFromR2(url);
  }
}

export { isR2Configured };
