import PDFDocument from "pdfkit";
import { Response } from "express";
import QRCode from "qrcode";

// pdfkit's default export is a value (the constructor), not a type -
// `import PDFDocument from "pdfkit"` alone can't be used in type
// positions like `(doc: PDFDocument) => ...`. Alias the *type* via
// `typeof` and keep using the same `PDFDocument` name for the class/type
// throughout this file for readability.
type PDFDocument = InstanceType<typeof PDFDocument>;

/**
 * Shared PDFKit helpers for the fee-receipt / ID-card / marksheet
 * generators below. We use pdfkit (pure JS, no native deps or
 * LibreOffice/headless-Chrome requirement) so PDF generation works the
 * same in any Node environment without extra system packages.
 *
 * Every generator streams directly to the HTTP response instead of
 * writing to disk first - simpler ops story (nothing to clean up) and
 * the PDF always reflects the latest DB state at request time rather
 * than a possibly-stale pre-generated file.
 */

export const startPdfResponse = (res: Response, filename: string): PDFDocument => {
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  doc.pipe(res);
  return doc;
};

/**
 * Sends an already-rendered PDF Buffer directly as the HTTP response,
 * with the same headers `startPdfResponse` would set. Used by
 * generators that now try an admin-uploaded .docx template FIRST (via
 * `templateRenderer.service.ts`, which only ever returns a plain
 * Buffer - it has no PDFDocument to stream) before falling back to the
 * PDFKit `startPdfResponse`/`doc.end()` path used everywhere else in
 * this file.
 */
export const sendPdfBuffer = (res: Response, filename: string, buffer: Buffer): void => {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  res.send(buffer);
};

export const drawHeader = (doc: PDFDocument, schoolName: string, subtitle: string) => {
  doc
    .fontSize(18)
    .fillColor("#1e293b")
    .text(schoolName, { align: "center" })
    .fontSize(11)
    .fillColor("#64748b")
    .text(subtitle, { align: "center" })
    .moveDown(0.5);
  doc
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .strokeColor("#cbd5e1")
    .stroke();
  doc.moveDown(1);
};

export const drawFooter = (doc: PDFDocument, note: string) => {
  const bottom = doc.page.height - doc.page.margins.bottom;
  doc
    .fontSize(8)
    .fillColor("#94a3b8")
    .text(note, doc.page.margins.left, bottom - 20, {
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      align: "center",
    });
};

export const drawKeyValueRow = (doc: PDFDocument, label: string, value: string, x: number, y: number, labelWidth = 110) => {
  doc.fontSize(10).fillColor("#475569").text(label, x, y, { width: labelWidth });
  doc.fontSize(10).fillColor("#0f172a").text(value || "-", x + labelWidth, y);
};

export const formatMoney = (n: number | string | { toString(): string }): string =>
  `Rs ${Number(n.toString()).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export const formatDate = (d: Date): string =>
  new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(d);

/**
 * Renders `data` (typically a verification/detail URL) as a QR code PNG
 * data buffer, ready to hand to PDFKit's `doc.image()`. Used by every
 * generated PDF in this app (certificates, ID cards, fee receipts,
 * payslips, report cards, admission forms) so a printed document can be
 * scanned on a phone to jump straight to its digital record/verification
 * page, instead of a human having to type a long URL/serial number by
 * hand.
 *
 * Returns null instead of throwing on failure (e.g. an unexpectedly
 * huge payload that can't fit any QR version) - a missing QR image
 * should never take down PDF generation for a document that's still
 * perfectly usable without one; callers should skip drawing it when
 * this resolves to null.
 */
export const generateQrCodeBuffer = async (data: string): Promise<Buffer | null> => {
  try {
    return await QRCode.toBuffer(data, {
      type: "png",
      errorCorrectionLevel: "M",
      margin: 1,
      width: 200,
    });
  } catch (error) {
    console.error("Failed to generate QR code:", (error as Error).message);
    return null;
  }
};

/**
 * Draws a QR code (built from `data`) plus an optional caption at
 * (x, y) on an in-progress PDFKit document, sized `size` points square.
 * Silently draws nothing if QR generation fails (see
 * generateQrCodeBuffer) - never throws, so one bad QR payload can't
 * blank out an otherwise-complete document.
 */
export const drawQrCode = async (
  doc: PDFDocument,
  data: string,
  x: number,
  y: number,
  size = 80,
  caption?: string
): Promise<void> => {
  const qrBuffer = await generateQrCodeBuffer(data);
  if (!qrBuffer) return;

  doc.image(qrBuffer, x, y, { width: size, height: size });
  if (caption) {
    doc.fontSize(6).fillColor("#94a3b8").text(caption, x - 10, y + size + 2, { width: size + 20, align: "center" });
  }
};

/**
 * Builds a PDFDocument that is NOT piped to an HTTP response - instead
 * it accumulates its output in memory and resolves to a single Buffer
 * once the caller calls `doc.end()`.
 *
 * Needed by the certificate generators (TC/Bonafide/Character): unlike
 * the fee-receipt/ID-card/report-card generators (which always stream
 * directly to the request that asked for them), a generated certificate
 * is persisted once (as a `GeneratedCertificate` row + a re-downloadable
 * PDF) and may be downloaded many times later, by staff, the student,
 * or a public verifier - none of whom are the original request that
 * triggered generation. Capturing the bytes as a Buffer lets the
 * controller store them (e.g. via `StorageProvider.save`) instead of
 * writing directly to that one response.
 */
export const renderPdfToBuffer = async (build: (doc: PDFDocument) => void | Promise<void>): Promise<Buffer> => {
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  const donePromise = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // `build` now draws a QR code (drawQrCode, above), which is async -
  // await it before calling doc.end() so the QR image is fully written
  // into the document stream first.
  await build(doc);
  doc.end();

  return donePromise;
};
