import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { storage } from "./storage.service";
import { convertDocxToPdf } from "./docxToPdf.service";

/**
 * Fills an uploaded .docx template's {{placeholders}} with real data
 * and (when possible) converts the result to a PDF - the "generate
 * from the admin-uploaded template" half of the Templates feature.
 * See docxToPdf.service.ts for why PDF conversion is optional and how
 * to enable it.
 *
 * Every certificate/document generator in this codebase calls
 * `renderTemplateForType` FIRST and only falls back to its own
 * hardcoded PDFKit layout when this returns null - i.e. an uploaded
 * template (once LibreOffice is available) always takes priority over
 * the built-in design, but a missing/unusable template or a
 * LibreOffice-less host never blocks certificate/document generation.
 */

/**
 * Flat key/value data for simple {{tag}} placeholders, PLUS optionally
 * an array value for docxtemplater's loop syntax
 * ({{#arrayKey}}...{{/arrayKey}}) - e.g. a report card's per-subject
 * rows. Because the delimiters below are overridden to double curly
 * braces, the loop tags MUST also use double curly braces (docxtemplater
 * uses one lexer/delimiter pair for every tag type, including loops) -
 * single-brace loop tags like {#arrayKey} are NOT recognized and are
 * left as literal text in the output. Most callers only ever populate
 * the flat string/number fields; the array shape only matters to a
 * school that has customized their uploaded template to include a
 * repeating table.
 */
export type TemplateData = Record<string, string | number | Record<string, string | number>[]>;

/**
 * Fills the placeholders in a DOCX buffer with the given flat key/value
 * data (docxtemplater's default `{tag}`-style syntax is overridden to
 * `{{tag}}` below to match the Templates page's placeholder guide and
 * avoid colliding with legitimate single-brace text a school might
 * already have in a template, e.g. currency amounts written as "{approx}").
 * Missing keys resolve to an empty string rather than throwing, since a
 * school's custom template may reasonably omit some optional fields.
 */
export const fillDocxTemplate = (docxBuffer: Buffer, data: TemplateData): Buffer => {
  const zip = new PizZip(docxBuffer);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "{{", end: "}}" },
    nullGetter: () => "",
  });
  doc.render(data);
  return doc.getZip().generate({ type: "nodebuffer" }) as Buffer;
};

/**
 * Loads the currently-uploaded template for a given DB row's
 * `templateUrl`, fills in `data`, and attempts a PDF conversion.
 *
 * Returns null if:
 *  - no template row was provided (nothing uploaded for this slot yet)
 *  - the uploaded file can no longer be read from storage
 *  - the .docx has malformed/unbalanced template tags (docxtemplater throws)
 *  - LibreOffice isn't available to convert the filled DOCX to PDF
 *
 * In every one of those cases the caller should fall back to its own
 * PDFKit-rendered document - this function deliberately swallows all
 * of the above into a single `null` rather than distinguishing them,
 * since the caller's response is identical either way (use the
 * fallback).
 */
export const renderTemplateToPdf = async (
  templateUrl: string | null | undefined,
  data: TemplateData
): Promise<Buffer | null> => {
  if (!templateUrl) return null;

  try {
    const docxBuffer = await storage.readByUrl(templateUrl);
    if (!docxBuffer) return null;

    const filledDocx = fillDocxTemplate(docxBuffer, data);
    const pdfBuffer = await convertDocxToPdf(filledDocx);
    return pdfBuffer; // null if LibreOffice isn't installed on this host
  } catch (error) {
    console.error("Failed to render uploaded template to PDF:", (error as Error).message);
    return null;
  }
};
