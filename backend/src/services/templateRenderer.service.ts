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
 * A school building/uploading their own .docx template has no way to
 * know that THIS app requires placeholders wrapped in DOUBLE curly
 * braces ({{tag}}, {{#loop}}...{{/loop}}) rather than docxtemplater's
 * own DEFAULT single-brace syntax ({tag}, {#loop}...{/loop}) - Word
 * doesn't visually distinguish the two, and copying an example from
 * docxtemplater's own public docs (which use single braces) is an
 * easy, completely understandable mistake. Left uncorrected, every
 * single-brace tag is simply ignored by our {{ }}-configured renderer
 * and printed as literal text in the generated PDF (e.g. a real report
 * from a school's custom Admit Card template: the flat {{studentName}}-
 * style fields they'd typed correctly all rendered fine, but their
 * subjects table used single-brace {#subjects}/{subjectName}/{/subjects}
 * and came out as that literal text instead of real rows).
 *
 * This scans a document part's raw XML for single-brace tags and
 * upgrades them to double-brace IN PLACE, but ONLY when the tag name
 * matches a real key (or, for a loop start/end tag, a real array-
 * valued key) actually present in `data` for THIS render call - never
 * touching arbitrary single-brace text a school might have typed for
 * an unrelated reason (e.g. a currency note written as "{approx}"),
 * since that text is never going to happen to match one of this
 * document type's own known field names. Already-correct {{tag}}
 * templates are left completely untouched (the lookbehind/lookahead
 * below reject a `{`/`}` that's actually part of a double-brace pair).
 */
const upgradeSingleBraceTags = (xml: string, data: TemplateData): string => {
  const flatKeys = new Set<string>();
  const loopKeys = new Set<string>();
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      loopKeys.add(key);
      for (const item of value) {
        for (const innerKey of Object.keys(item)) flatKeys.add(innerKey);
      }
    } else {
      flatKeys.add(key);
    }
  }
  if (flatKeys.size === 0 && loopKeys.size === 0) return xml;

  return xml.replace(/(?<!\{)\{(#|\/)?([A-Za-z_][A-Za-z0-9_]*)\}(?!\})/g, (match, prefix, name) => {
    if (prefix) return loopKeys.has(name) ? `{{${prefix}${name}}}` : match;
    return flatKeys.has(name) ? `{{${name}}}` : match;
  });
};

/**
 * Applies upgradeSingleBraceTags to every document/header/footer XML
 * part inside the DOCX zip, in place, before docxtemplater ever parses
 * it. Silently skips a part it can't read/rewrite (should never
 * happen for a well-formed .docx) rather than failing the whole
 * render over an edge case - fillDocxTemplate's caller already treats
 * any downstream docxtemplater failure as "fall back to the PDFKit
 * layout", so a skipped part here just means that specific part keeps
 * whatever single-brace text it had.
 */
const upgradeSingleBraceTagsInZip = (zip: PizZip, data: TemplateData): void => {
  // PizZip's shipped typings don't fully describe the JSZip-compatible
  // `.files` map / `.file(name)` / `.file(name, content)` overloads
  // used below (all long-standing, documented PizZip APIs - see
  // https://github.com/open-xml-templating/pizzip) - cast to `any`
  // here rather than fight the incomplete types for what's otherwise
  // straightforward zip-entry read/rewrite.
  const zipAny = zip as any;
  const partNames = Object.keys(zipAny.files as Record<string, unknown>).filter((name) =>
    /^word\/(document|header\d*|footer\d*)\.xml$/.test(name)
  );
  for (const name of partNames) {
    try {
      const entry = zipAny.file(name);
      const original: string | undefined = entry?.asText();
      if (!original) continue;
      const upgraded = upgradeSingleBraceTags(original, data);
      if (upgraded !== original) zipAny.file(name, upgraded);
    } catch {
      // See comment above - leave this part as-is on any failure.
    }
  }
};

/**
 * Fills the placeholders in a DOCX buffer with the given flat key/value
 * data (docxtemplater's default `{tag}`-style syntax is overridden to
 * `{{tag}}` below to match the Templates page's placeholder guide and
 * avoid colliding with legitimate single-brace text a school might
 * already have in a template, e.g. currency amounts written as "{approx}").
 * Before rendering, upgradeSingleBraceTagsInZip auto-corrects any
 * single-brace tags a school's template used BY MISTAKE (matching this
 * call's own known data keys) up to the double-brace syntax this app
 * actually requires - see that function's comment for why this is safe.
 * Missing keys resolve to an empty string rather than throwing, since a
 * school's custom template may reasonably omit some optional fields.
 */
export const fillDocxTemplate = (docxBuffer: Buffer, data: TemplateData): Buffer => {
  const zip = new PizZip(docxBuffer);
  upgradeSingleBraceTagsInZip(zip, data);
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
