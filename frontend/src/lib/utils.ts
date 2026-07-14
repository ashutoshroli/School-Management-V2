import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * BUG FIX: this previously did `new Intl.DateTimeFormat(...).format(new Date(date))`
 * with no validity check at all - `Intl.DateTimeFormat.format()` THROWS
 * a RangeError ("Invalid time value") when given an Invalid Date, and
 * that throw happens DURING RENDER (this is almost always called
 * straight inside JSX). An uncaught render-time exception crashes the
 * entire page with Next.js's generic "Application error: a client-side
 * exception has occurred" - with zero indication in the UI of which
 * value or which page caused it. `date` being null/undefined/empty-
 * string/malformed is a completely normal, expected case throughout
 * this app (an optional field that was never filled in, a value not
 * yet loaded, etc) - it should render as a harmless placeholder, never
 * take down the whole page.
 */
export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "-";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

/**
 * Today's date as a "YYYY-MM-DD" string in the BROWSER'S LOCAL
 * timezone, suitable as the default value for an <input type="date">.
 *
 * BUG FIX: attendance pages previously defaulted to
 * `new Date().toISOString().split("T")[0]` - `toISOString()` always
 * converts to UTC first, so for any user west of UTC (all of the
 * Americas, for example) this returns TOMORROW'S date between
 * midnight local time and midnight UTC, and for any user east of UTC
 * (e.g. IST, UTC+5:30) it can return YESTERDAY'S date is not actually
 * possible (IST is ahead, so it only ever shows today's or a later
 * UTC date) - but the Americas case is a real, everyday off-by-one:
 * an admin marking attendance right after midnight would have the
 * date picker default to a day that hasn't started yet locally, and
 * submitting it would create an attendance record dated "tomorrow"
 * that doesn't match what the backend derives from a genuinely local
 * "today" tap.
 */
export function todayLocalDateInput(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
