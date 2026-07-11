import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    payment: { findMany: jest.fn(), groupBy: jest.fn() },
    feeAssignment: { findMany: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { getFeeCollectionTrend, getPaymentModeBreakdown, exportDefaultersCsv } from "../feeReports.controller";
import { AuthRequest } from "../../types";

const makeMockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn();
  res.send = jest.fn();
  return res;
};

const makeReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
  ({
    body: {},
    params: {},
    query: {},
    user: { userId: "admin-1", email: "admin@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" },
    ...overrides,
  } as any);

describe("feeReports.controller - Phase 6 additions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date("2025-06-15T00:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("getFeeCollectionTrend", () => {
    it("requires a resolvable branchId", async () => {
      const req = makeReq({ user: { userId: "u1", email: "e", role: UserRole.SUPER_ADMIN } });
      const res = makeMockRes();

      await getFeeCollectionTrend(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("returns one bucket per day in the requested range, even with zero payments on some days", async () => {
      (prisma.payment.findMany as jest.Mock).mockResolvedValue([
        { amount: 500 as any, paidAt: new Date("2025-06-14T10:00:00Z") },
        { amount: 1500 as any, paidAt: new Date("2025-06-14T14:00:00Z") },
      ]);

      const req = makeReq({ query: { days: "3" } });
      const res = makeMockRes();

      await getFeeCollectionTrend(req, res);

      const [payload] = (res.json as jest.Mock).mock.calls[0];
      expect(payload.data.trend).toHaveLength(3);
      expect(payload.data.totalCollected).toBe(2000);
      // Two payments on the same calendar day should be summed into a single bucket.
      const juneFourteenth = payload.data.trend.find((t: any) => t.date === "2025-06-14");
      expect(juneFourteenth.amount).toBe(2000);
    });

    it("caps the days parameter at 365 to avoid an unbounded query range", async () => {
      (prisma.payment.findMany as jest.Mock).mockResolvedValue([]);
      const req = makeReq({ query: { days: "9999" } });
      const res = makeMockRes();

      await getFeeCollectionTrend(req, res);

      const [payload] = (res.json as jest.Mock).mock.calls[0];
      expect(payload.data.days).toBe(365);
    });
  });

  describe("getPaymentModeBreakdown", () => {
    it("returns amount/count per payment mode from prisma groupBy", async () => {
      (prisma.payment.groupBy as jest.Mock).mockResolvedValue([
        { paymentMode: "CASH", _sum: { amount: 5000 as any }, _count: 10 },
        { paymentMode: "UPI", _sum: { amount: 3000 as any }, _count: 6 },
      ]);

      const req = makeReq();
      const res = makeMockRes();

      await getPaymentModeBreakdown(req, res);

      const [payload] = (res.json as jest.Mock).mock.calls[0];
      expect(payload.data).toEqual([
        { paymentMode: "CASH", totalAmount: 5000, transactionCount: 10 },
        { paymentMode: "UPI", totalAmount: 3000, transactionCount: 6 },
      ]);
    });
  });

  describe("exportDefaultersCsv", () => {
    it("returns a CSV attachment with the correct headers", async () => {
      (prisma.feeAssignment.findMany as jest.Mock).mockResolvedValue([
        {
          totalAmount: 1000 as any,
          paidAmount: 200 as any,
          discount: 0 as any,
          lateFee: 0 as any,
          status: "PARTIAL",
          student: {
            user: { name: "Ravi Kumar", phone: "9876543210" },
            class: { name: "Class 5" },
            section: { name: "A" },
          },
          feeStructure: { feeCategory: { name: "Tuition" } },
        },
      ]);

      const req = makeReq();
      const res = makeMockRes();

      await exportDefaultersCsv(req, res);

      expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/csv; charset=utf-8");
      const sentBody = (res.send as jest.Mock).mock.calls[0][0];
      expect(sentBody).toContain("Ravi Kumar");
      expect(sentBody).toContain("800.00"); // pendingAmount = 1000 - 200
    });

    it("requires a resolvable branchId", async () => {
      const req = makeReq({ user: { userId: "u1", email: "e", role: UserRole.SUPER_ADMIN } });
      const res = makeMockRes();

      await exportDefaultersCsv(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(prisma.feeAssignment.findMany).not.toHaveBeenCalled();
    });
  });
});
