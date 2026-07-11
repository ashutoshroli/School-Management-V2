import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    account: { findUnique: jest.fn(), create: jest.fn(), findMany: jest.fn(), createMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

import prisma from "../../config/database";
import { createAccount, createVoucher, setupDefaultAccounts } from "../accounting.controller";
import { AuthRequest } from "../../types";
import { DEFAULT_CHART_OF_ACCOUNTS } from "../../services/defaultChartOfAccounts";

const makeMockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
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

describe("accounting.controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createAccount", () => {
    beforeEach(() => {
      (prisma.account.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.account.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "acc-1", ...data }));
    });

    it("BUG FIX: falls back to the caller's own branch when the client sends an empty branchId", async () => {
      const req = makeReq({ body: { branchId: "", name: "Cash", code: "1000", type: "ASSET" } });
      const res = makeMockRes();

      await createAccount(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect((prisma.account.create as jest.Mock).mock.calls[0][0].data.branchId).toBe("branch-1");
    });

    it("returns 400 when no branchId can be resolved", async () => {
      const req = makeReq({
        body: { branchId: "", name: "Cash", code: "1000", type: "ASSET" },
        user: { userId: "u1", email: "e", role: UserRole.ACCOUNTANT, branchId: undefined },
      });
      const res = makeMockRes();

      await createAccount(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(prisma.account.create).not.toHaveBeenCalled();
    });

    it("SECURITY: silently neutralizes a Branch Admin trying to target a different branch (creates under their own branch instead)", async () => {
      const req = makeReq({ body: { branchId: "branch-OTHER", name: "Cash", code: "1000", type: "ASSET" } });
      const res = makeMockRes();

      await createAccount(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect((prisma.account.create as jest.Mock).mock.calls[0][0].data.branchId).toBe("branch-1");
    });
  });

  describe("createVoucher", () => {
    const validEntries = [{ debitAccountId: "acc-1", creditAccountId: "acc-2", amount: 500, narration: "test" }];

    beforeEach(() => {
      (prisma.$transaction as jest.Mock).mockImplementation(async (callback: any) => {
        const tx = {
          voucher: {
            count: jest.fn().mockResolvedValue(0),
            create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "v-1", ...data })),
            findUnique: jest.fn().mockResolvedValue({ id: "v-1", entries: [] }),
          },
          voucherEntry: { createMany: jest.fn().mockResolvedValue({}) },
        };
        return callback(tx);
      });
    });

    it("BUG FIX: falls back to the caller's own branch when the client sends an empty branchId", async () => {
      const req = makeReq({ body: { branchId: "", type: "PAYMENT", date: "2025-06-01", entries: validEntries } });
      const res = makeMockRes();

      await createVoucher(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
    });

    it("returns 400 when no branchId can be resolved", async () => {
      const req = makeReq({
        body: { branchId: "", type: "PAYMENT", date: "2025-06-01", entries: validEntries },
        user: { userId: "u1", email: "e", role: UserRole.ACCOUNTANT, branchId: undefined },
      });
      const res = makeMockRes();

      await createVoucher(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("SECURITY: silently neutralizes a Branch Admin trying to target a different branch (creates under their own branch instead)", async () => {
      const req = makeReq({ body: { branchId: "branch-OTHER", type: "PAYMENT", date: "2025-06-01", entries: validEntries } });
      const res = makeMockRes();

      await createVoucher(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
    });

    it("rejects when no entries are provided", async () => {
      const req = makeReq({ body: { branchId: "", type: "PAYMENT", date: "2025-06-01", entries: [] } });
      const res = makeMockRes();

      await createVoucher(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // BUG FIX: a branch created through the app (as opposed to
  // db/prisma/seed.ts's demo data) had NO Chart of Accounts at all,
  // which made every fee payment fail with "Failed to collect payment"
  // (autoPostToAccounting requires a Cash/1001 + Fee Income/3001
  // account to exist - see feePayment.service.ts). This endpoint lets
  // an admin backfill the missing defaults for their branch without
  // needing database/shell access.
  describe("setupDefaultAccounts", () => {
    it("seeds every default account for the caller's own branch when none exist", async () => {
      (prisma.account.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.account.createMany as jest.Mock).mockResolvedValue({ count: DEFAULT_CHART_OF_ACCOUNTS.length });

      const req = makeReq({ user: { userId: "u1", email: "e", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" } });
      const res = makeMockRes();

      await setupDefaultAccounts(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const createManyCall = (prisma.account.createMany as jest.Mock).mock.calls[0][0];
      expect(createManyCall.data).toHaveLength(DEFAULT_CHART_OF_ACCOUNTS.length);
      expect(createManyCall.data.every((a: any) => a.branchId === "branch-1")).toBe(true);
    });

    it("is a no-op (still 200) when every default account already exists", async () => {
      (prisma.account.findMany as jest.Mock).mockResolvedValue(
        DEFAULT_CHART_OF_ACCOUNTS.map((a) => ({ code: a.code }))
      );

      const req = makeReq({ user: { userId: "u1", email: "e", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" } });
      const res = makeMockRes();

      await setupDefaultAccounts(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(prisma.account.createMany).not.toHaveBeenCalled();
    });

    it("returns 400 when no branchId can be resolved", async () => {
      const req = makeReq({ user: { userId: "u1", email: "e", role: UserRole.ACCOUNTANT, branchId: undefined } });
      const res = makeMockRes();

      await setupDefaultAccounts(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(prisma.account.findMany).not.toHaveBeenCalled();
    });

    it("SECURITY: a Branch Admin always sets up defaults for their own branch, ignoring any ?branchId= query param", async () => {
      (prisma.account.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.account.createMany as jest.Mock).mockResolvedValue({ count: DEFAULT_CHART_OF_ACCOUNTS.length });

      const req = makeReq({
        query: { branchId: "branch-OTHER" },
        user: { userId: "u1", email: "e", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" },
      });
      const res = makeMockRes();

      await setupDefaultAccounts(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const createManyCall = (prisma.account.createMany as jest.Mock).mock.calls[0][0];
      expect(createManyCall.data.every((a: any) => a.branchId === "branch-1")).toBe(true);
    });
  });
});
