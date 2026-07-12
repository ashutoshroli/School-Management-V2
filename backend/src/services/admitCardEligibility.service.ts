import prisma from "../config/database";

/**
 * Admit Card eligibility rule engine - a checklist of independently
 * toggleable rules (the "multiple choice checklist" requested):
 *  - minAttendancePercent: minimum % attendance over a date range
 *    (defaults to the exam's academic year so far).
 *  - feesClearedTillMonth: monthly-frequency fees must be paid through
 *    a specific calendar month (inclusive).
 * Both are optional and independent - either, both, or neither can be
 * enabled. A student passes when EVERY enabled rule passes.
 */

export interface EligibilityRuleConfig {
  minAttendancePercent?: number; // e.g. 75
  attendanceFrom?: string; // ISO date, defaults to the exam's academic year start
  attendanceTo?: string; // ISO date, defaults to today
  feesClearedTillMonth?: string; // "YYYY-MM", inclusive
}

export interface RuleFailure {
  rule: "ATTENDANCE" | "FEES";
  message: string;
}

export interface EligibilityResult {
  eligible: boolean;
  failures: RuleFailure[];
  attendancePercent?: number;
  feesPending?: number;
}

/**
 * Computes a student's attendance % over [from, to] (inclusive),
 * counting PRESENT and LATE as present (matching the convention
 * already used by getStaffAttendanceReport's day-summary logic
 * elsewhere in this codebase - LATE is still "showed up").
 */
const computeAttendancePercent = async (studentId: string, from: Date, to: Date): Promise<number> => {
  const [total, present] = await Promise.all([
    prisma.studentAttendance.count({ where: { studentId, date: { gte: from, lte: to }, period: null } }),
    prisma.studentAttendance.count({
      where: { studentId, date: { gte: from, lte: to }, period: null, status: { in: ["PRESENT", "LATE"] } },
    }),
  ]);
  if (total === 0) return 100; // no attendance data at all - don't penalize; nothing to judge against
  return (present / total) * 100;
};

/**
 * Checks whether a student's MONTHLY-frequency fee assignments are
 * paid through `tillMonth` (inclusive). There's no per-student
 * per-month payment breakdown in this schema (FeeAssignment is one
 * row per student+feeStructure for the whole year, with an
 * accumulating paidAmount) - so this pro-rates: for each MONTHLY
 * assignment, expectedAmount = monthly rate x number of months
 * elapsed from the fee structure's academic year start through
 * `tillMonth` inclusive, compared against paidAmount + discount
 * already recorded. A student with no MONTHLY fee assignments at all
 * passes trivially (nothing to check).
 */
const checkFeesClearedTillMonth = async (studentId: string, tillMonth: string): Promise<{ passes: boolean; pending: number }> => {
  const [tillYear, tillMonthNum] = tillMonth.split("-").map(Number);
  // Last day of the target month, for an inclusive "through this month" cutoff.
  const cutoff = new Date(tillYear, tillMonthNum, 0, 23, 59, 59);

  const assignments = await prisma.feeAssignment.findMany({
    where: { studentId, feeStructure: { frequency: "MONTHLY" } },
    include: { feeStructure: { include: { academicYear: { select: { startDate: true } } } } },
  });

  if (assignments.length === 0) return { passes: true, pending: 0 };

  let totalPending = 0;
  for (const a of assignments) {
    const start = a.feeStructure.academicYear.startDate;
    // Number of calendar months from the academic year's start through
    // the cutoff month (inclusive), minimum 1 - e.g. a year starting
    // April 2026 with a cutoff of June 2026 = 3 months (Apr, May, Jun).
    const monthsElapsed = Math.max(
      1,
      (cutoff.getFullYear() - start.getFullYear()) * 12 + (cutoff.getMonth() - start.getMonth()) + 1
    );
    const expectedAmount = Number(a.feeStructure.amount) * monthsElapsed;
    const paidTotal = Number(a.paidAmount) + Number(a.discount);
    const pending = Math.max(0, expectedAmount - paidTotal);
    totalPending += pending;
  }

  return { passes: totalPending <= 0, pending: totalPending };
};

/**
 * Evaluates one student against the given rule config. Returns
 * `eligible: true` with no failures if no rules are enabled at all
 * (every enrolled student is simply eligible in that case).
 */
export const evaluateStudentEligibility = async (
  studentId: string,
  academicYearStartDate: Date,
  config: EligibilityRuleConfig
): Promise<EligibilityResult> => {
  const failures: RuleFailure[] = [];
  let attendancePercent: number | undefined;
  let feesPending: number | undefined;

  if (config.minAttendancePercent !== undefined) {
    const from = config.attendanceFrom ? new Date(config.attendanceFrom) : academicYearStartDate;
    const to = config.attendanceTo ? new Date(config.attendanceTo) : new Date();
    attendancePercent = await computeAttendancePercent(studentId, from, to);
    if (attendancePercent < config.minAttendancePercent) {
      failures.push({
        rule: "ATTENDANCE",
        message: `Attendance ${attendancePercent.toFixed(1)}% - below the ${config.minAttendancePercent}% requirement`,
      });
    }
  }

  if (config.feesClearedTillMonth) {
    const { passes, pending } = await checkFeesClearedTillMonth(studentId, config.feesClearedTillMonth);
    feesPending = pending;
    if (!passes) {
      failures.push({
        rule: "FEES",
        message: `Fees not cleared through ${config.feesClearedTillMonth} - Rs ${pending.toLocaleString("en-IN")} pending`,
      });
    }
  }

  return { eligible: failures.length === 0, failures, attendancePercent, feesPending };
};
