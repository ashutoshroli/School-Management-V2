import PDFDocument from "pdfkit";
import { Response } from "express";

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
