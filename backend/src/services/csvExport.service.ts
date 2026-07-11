import { Response } from "express";

/**
 * Minimal dependency-free CSV export helper (Phase 6 - Analytics &
 * Reports). Deliberately not using a CSV library (e.g. `csv-stringify`,
 * `exceljs` for true Excel) - RFC 4180 CSV escaping is a handful of
 * lines, and every report this app exports is a flat array of plain
 * objects, so a small hand-rolled implementation avoids adding a
 * dependency for something this simple. If a future report needs real
 * `.xlsx` formatting (multiple sheets, styling, formulas), that would
 * be the time to reach for a real library instead of extending this.
 */

export interface CsvColumn<T> {
  header: string;
  /** Extracts this column's raw value from a row - formatting (dates,
   *  currency, etc) is the caller's responsibility so this stays a
   *  dumb serializer, not a formatting layer. */
  accessor: (row: T) => string | number | boolean | null | undefined;
}

/** Escapes a single CSV field per RFC 4180: wrap in quotes and double up any embedded quotes if the value contains a comma, quote, or newline. */
const escapeCsvField = (value: string | number | boolean | null | undefined): string => {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

/** Builds a full CSV document (header row + data rows) as a single string. */
export const buildCsv = <T>(rows: T[], columns: CsvColumn<T>[]): string => {
  const headerLine = columns.map((c) => escapeCsvField(c.header)).join(",");
  const dataLines = rows.map((row) => columns.map((c) => escapeCsvField(c.accessor(row))).join(","));
  // CRLF line endings per RFC 4180 - also what Excel expects to reliably
  // detect the file as CSV rather than a single-column text blob.
  return [headerLine, ...dataLines].join("\r\n");
};

/**
 * Sends a CSV as a downloadable attachment. A leading UTF-8 BOM is
 * written before the content so Excel (which otherwise guesses the
 * system codepage for a BOM-less CSV) correctly renders non-ASCII
 * characters like "Rs" written as "₹" or accented names, instead of
 * mangling them.
 */
export const sendCsv = (res: Response, filename: string, csvContent: string): void => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(`\uFEFF${csvContent}`);
};
