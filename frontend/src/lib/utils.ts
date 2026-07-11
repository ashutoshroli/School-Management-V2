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

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(date));
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
