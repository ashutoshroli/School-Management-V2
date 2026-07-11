import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

/**
 * Converts a DOCX buffer to PDF by shelling out to LibreOffice's
 * headless CLI (`soffice --headless --convert-to pdf`), which is the
 * only reliable way to render arbitrary Word documents (tables,
 * images, page breaks, fonts, etc.) as a real PDF without reimplementing
 * a DOCX layout engine.
 *
 * This is an *optional* capability: LibreOffice is a large native
 * dependency that isn't installed in every deployment target (it's not
 * present in this project's dev sandbox, and isn't guaranteed on every
 * free-tier PaaS host either). Every caller of `convertDocxToPdf` MUST
 * treat a `null` return as "conversion unavailable here" and fall back
 * to the existing PDFKit-based generator for that document type -
 * never let a missing LibreOffice binary turn into a hard failure for
 * an admin trying to generate a certificate/receipt/payslip.
 *
 * To enable real DOCX-template rendering in production, install
 * LibreOffice on the host (e.g. `apt-get install libreoffice` in a
 * Dockerfile, or add it as a system dependency in the PaaS build) -
 * no code change is needed once the `soffice`/`libreoffice` binary is
 * on PATH.
 */

let cachedBinaryPath: string | null | undefined; // undefined = not yet checked

const CANDIDATE_BINARIES = ["soffice", "libreoffice"];

const commandExists = (binary: string): Promise<boolean> =>
  new Promise((resolve) => {
    const check = spawn(process.platform === "win32" ? "where" : "which", [binary]);
    check.on("error", () => resolve(false));
    check.on("close", (code) => resolve(code === 0));
  });

/**
 * Finds and caches the LibreOffice CLI binary name available on this
 * host, or null if neither `soffice` nor `libreoffice` is on PATH.
 * Cached for the lifetime of the process since the host's installed
 * software doesn't change between requests.
 */
export const findLibreOfficeBinary = async (): Promise<string | null> => {
  if (cachedBinaryPath !== undefined) return cachedBinaryPath;

  for (const binary of CANDIDATE_BINARIES) {
    if (await commandExists(binary)) {
      cachedBinaryPath = binary;
      return cachedBinaryPath;
    }
  }
  cachedBinaryPath = null;
  return null;
};

/** Test-only hook to reset the cached binary lookup between test cases. */
export const _resetLibreOfficeCache = () => {
  cachedBinaryPath = undefined;
};

const CONVERSION_TIMEOUT_MS = 30_000;

/**
 * Converts a DOCX buffer to a PDF buffer via LibreOffice headless mode.
 * Returns null (never throws) if LibreOffice isn't installed on this
 * host, so callers can fall back to a PDFKit-rendered document instead.
 * Actual conversion failures (corrupt file, LibreOffice crash, timeout)
 * also resolve to null for the same reason - a broken/unusual uploaded
 * template should never 500 the whole "generate" request when a
 * perfectly good hardcoded fallback exists.
 */
export const convertDocxToPdf = async (docxBuffer: Buffer): Promise<Buffer | null> => {
  const binary = await findLibreOfficeBinary();
  if (!binary) return null;

  const workDir = path.join(os.tmpdir(), `docx2pdf-${crypto.randomUUID()}`);
  const inputPath = path.join(workDir, "input.docx");
  const outputPath = path.join(workDir, "input.pdf");

  try {
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(inputPath, docxBuffer);

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(binary, [
        "--headless",
        "--norestore",
        "--convert-to",
        "pdf",
        "--outdir",
        workDir,
        inputPath,
      ]);

      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        reject(new Error("LibreOffice conversion timed out"));
      }, CONVERSION_TIMEOUT_MS);

      proc.on("error", (err) => { clearTimeout(timer); reject(err); });
      proc.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`LibreOffice exited with code ${code}`));
      });
    });

    if (!fs.existsSync(outputPath)) return null;
    return fs.readFileSync(outputPath);
  } catch (error) {
    console.error("DOCX to PDF conversion failed:", (error as Error).message);
    return null;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
};
