/**
 * Normalizes a Date to a "date-only" UTC-midnight instant for the
 * given Date's own LOCAL calendar day.
 *
 * BUG FIX: attendance is recorded from two different paths that used
 * to compute "the date" inconsistently:
 *   - Manual marking (markStudentAttendance/markAttendance) receives a
 *     plain "YYYY-MM-DD" string from an <input type="date"> and does
 *     `new Date(dateString)` - per the ECMA-262 spec, a date-only
 *     string is ALWAYS parsed as UTC midnight, regardless of server
 *     timezone.
 *   - Card-tap marking (studentCardTap/cardTapAttendance) used to do
 *     `new Date(tapTime.getFullYear(), tapTime.getMonth(),
 *     tapTime.getDate())` - the local Date constructor, which produces
 *     LOCAL midnight, not UTC midnight.
 *
 * Whenever the server process's timezone isn't UTC (true for most
 * non-Render/non-explicitly-configured environments, e.g. a developer
 * running the backend locally in IST), these two paths produce
 * DIFFERENT DateTime values for "the same day" - a card-tap and a
 * manually-marked record for the same calendar day would violate
 * uniqueness expectations silently (two separate rows instead of one
 * being updated), and a teacher's manual view would never show a
 * card-tap's attendance as already present for that day (or vice
 * versa), since queries filter by exact date equality.
 *
 * Both call sites now go through this helper so "today" always means
 * the same UTC instant no matter which path recorded it.
 */
export const toAttendanceDateOnly = (d: Date): Date =>
  new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
