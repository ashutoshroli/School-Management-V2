jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    studentAttendance: { count: jest.fn() },
    feeAssignment: { findMany: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { evaluateStudentEligibility } from "../admitCardEligibility.service";

const ACADEMIC_YEAR_START = new Date("2026-04-01");

describe("admitCardEligibility.service - evaluateStudentEligibility", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("is eligible with no failures when NO rules are enabled at all", async () => {
    const result = await evaluateStudentEligibility("stu-1", ACADEMIC_YEAR_START, {});

    expect(result.eligible).toBe(true);
    expect(result.failures).toEqual([]);
    expect(prisma.studentAttendance.count).not.toHaveBeenCalled();
    expect(prisma.feeAssignment.findMany).not.toHaveBeenCalled();
  });

  describe("attendance rule", () => {
    it("passes when attendance % is at or above the threshold", async () => {
      (prisma.studentAttendance.count as jest.Mock)
        .mockResolvedValueOnce(100) // total
        .mockResolvedValueOnce(80); // present (PRESENT+LATE)

      const result = await evaluateStudentEligibility("stu-1", ACADEMIC_YEAR_START, { minAttendancePercent: 75 });

      expect(result.eligible).toBe(true);
      expect(result.attendancePercent).toBe(80);
      expect(result.failures).toEqual([]);
    });

    it("fails when attendance % is below the threshold, with a descriptive message", async () => {
      (prisma.studentAttendance.count as jest.Mock)
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(60);

      const result = await evaluateStudentEligibility("stu-1", ACADEMIC_YEAR_START, { minAttendancePercent: 75 });

      expect(result.eligible).toBe(false);
      expect(result.attendancePercent).toBe(60);
      expect(result.failures).toEqual([{ rule: "ATTENDANCE", message: "Attendance 60.0% - below the 75% requirement" }]);
    });

    it("counts LATE as present, not absent", async () => {
      (prisma.studentAttendance.count as jest.Mock)
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(8); // PRESENT + LATE
      const req = { minAttendancePercent: 75 };

      const result = await evaluateStudentEligibility("stu-1", ACADEMIC_YEAR_START, req);

      expect((prisma.studentAttendance.count as jest.Mock).mock.calls[1][0].where.status).toEqual({ in: ["PRESENT", "LATE"] });
      expect(result.attendancePercent).toBe(80);
    });

    it("does not penalize a student with zero attendance records at all (nothing to judge against)", async () => {
      (prisma.studentAttendance.count as jest.Mock).mockResolvedValueOnce(0).mockResolvedValueOnce(0);

      const result = await evaluateStudentEligibility("stu-1", ACADEMIC_YEAR_START, { minAttendancePercent: 75 });

      expect(result.eligible).toBe(true);
      expect(result.attendancePercent).toBe(100);
    });

    it("uses the given attendanceFrom/attendanceTo range instead of the academic year default when provided", async () => {
      (prisma.studentAttendance.count as jest.Mock).mockResolvedValueOnce(10).mockResolvedValueOnce(10);

      await evaluateStudentEligibility("stu-1", ACADEMIC_YEAR_START, {
        minAttendancePercent: 75,
        attendanceFrom: "2026-06-01",
        attendanceTo: "2026-06-30",
      });

      const where = (prisma.studentAttendance.count as jest.Mock).mock.calls[0][0].where;
      expect(where.date.gte).toEqual(new Date("2026-06-01"));
      expect(where.date.lte).toEqual(new Date("2026-06-30"));
    });
  });

  describe("fees-cleared-till-month rule", () => {
    it("passes trivially when the student has no MONTHLY fee assignments at all", async () => {
      (prisma.feeAssignment.findMany as jest.Mock).mockResolvedValue([]);

      const result = await evaluateStudentEligibility("stu-1", ACADEMIC_YEAR_START, { feesClearedTillMonth: "2026-06" });

      expect(result.eligible).toBe(true);
      expect(result.feesPending).toBe(0);
    });

    it("passes when paidAmount+discount covers the pro-rated expected amount through the target month", async () => {
      (prisma.feeAssignment.findMany as jest.Mock).mockResolvedValue([
        {
          paidAmount: 3000,
          discount: 0,
          feeStructure: { amount: 1000, academicYear: { startDate: new Date("2026-04-01") } },
        },
      ]);
      // Academic year starts April 2026; cutoff June 2026 -> 3 months
      // elapsed (Apr, May, Jun) x Rs 1000 = Rs 3000 expected.

      const result = await evaluateStudentEligibility("stu-1", ACADEMIC_YEAR_START, { feesClearedTillMonth: "2026-06" });

      expect(result.eligible).toBe(true);
      expect(result.feesPending).toBe(0);
    });

    it("fails with the pending amount when paidAmount falls short of the pro-rated expected amount", async () => {
      (prisma.feeAssignment.findMany as jest.Mock).mockResolvedValue([
        {
          paidAmount: 1000,
          discount: 0,
          feeStructure: { amount: 1000, academicYear: { startDate: new Date("2026-04-01") } },
        },
      ]);
      // 3 months elapsed x Rs 1000 = Rs 3000 expected, only Rs 1000 paid -> Rs 2000 pending.

      const result = await evaluateStudentEligibility("stu-1", ACADEMIC_YEAR_START, { feesClearedTillMonth: "2026-06" });

      expect(result.eligible).toBe(false);
      expect(result.feesPending).toBe(2000);
      expect(result.failures[0].rule).toBe("FEES");
      expect(result.failures[0].message).toContain("2,000");
    });

    it("counts discount toward the paid total (a waived amount isn't still 'pending')", async () => {
      (prisma.feeAssignment.findMany as jest.Mock).mockResolvedValue([
        {
          paidAmount: 1000,
          discount: 2000,
          feeStructure: { amount: 1000, academicYear: { startDate: new Date("2026-04-01") } },
        },
      ]);

      const result = await evaluateStudentEligibility("stu-1", ACADEMIC_YEAR_START, { feesClearedTillMonth: "2026-06" });

      expect(result.eligible).toBe(true);
    });

    it("sums pending across multiple MONTHLY fee assignments", async () => {
      (prisma.feeAssignment.findMany as jest.Mock).mockResolvedValue([
        { paidAmount: 0, discount: 0, feeStructure: { amount: 500, academicYear: { startDate: new Date("2026-04-01") } } },
        { paidAmount: 0, discount: 0, feeStructure: { amount: 300, academicYear: { startDate: new Date("2026-04-01") } } },
      ]);
      // 3 months elapsed each: (500*3) + (300*3) = 2400 pending.

      const result = await evaluateStudentEligibility("stu-1", ACADEMIC_YEAR_START, { feesClearedTillMonth: "2026-06" });

      expect(result.feesPending).toBe(2400);
    });

    it("only considers MONTHLY-frequency fee structures", async () => {
      await evaluateStudentEligibility("stu-1", ACADEMIC_YEAR_START, { feesClearedTillMonth: "2026-06" });

      expect((prisma.feeAssignment.findMany as jest.Mock).mock.calls[0][0].where.feeStructure).toEqual({ frequency: "MONTHLY" });
    });
  });

  it("evaluates BOTH rules together and fails if either one fails", async () => {
    (prisma.studentAttendance.count as jest.Mock).mockResolvedValueOnce(100).mockResolvedValueOnce(60); // 60% - fails
    (prisma.feeAssignment.findMany as jest.Mock).mockResolvedValue([]); // fees pass trivially

    const result = await evaluateStudentEligibility("stu-1", ACADEMIC_YEAR_START, {
      minAttendancePercent: 75,
      feesClearedTillMonth: "2026-06",
    });

    expect(result.eligible).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].rule).toBe("ATTENDANCE");
  });

  it("passes when BOTH enabled rules pass", async () => {
    (prisma.studentAttendance.count as jest.Mock).mockResolvedValueOnce(100).mockResolvedValueOnce(90);
    (prisma.feeAssignment.findMany as jest.Mock).mockResolvedValue([]);

    const result = await evaluateStudentEligibility("stu-1", ACADEMIC_YEAR_START, {
      minAttendancePercent: 75,
      feesClearedTillMonth: "2026-06",
    });

    expect(result.eligible).toBe(true);
    expect(result.failures).toEqual([]);
  });
});
