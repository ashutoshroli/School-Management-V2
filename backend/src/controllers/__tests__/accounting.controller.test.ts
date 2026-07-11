import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    account: { findUnique: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(),
  },
}));

import prisma from "../../config/database";
import { createAccount, createVoucher } from "../accounting.controller";
import { AuthRequest } from "../../types";

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

    it("SECURITY: rejects a Branch Admin explicitly targeting a different branch", async () => {
      const req = makeReq({ body: { branchId: "branch-OTHER", name: "Cash", code: "1000", type: "ASSET" } });
      const res = makeMockRes();

      await createAccount(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(prisma.account.create).not.toHaveBeenCalled();
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

    it("SECURITY: rejects a Branch Admin explicitly targeting a different branch", async () => {
      const req = makeReq({ body: { branchId: "branch-OTHER", type: "PAYMENT", date: "2025-06-01", entries: validEntries } });
      const res = makeMockRes();

      await createVoucher(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("rejects when no entries are provided", async () => {
      const req = makeReq({ body: { branchId: "", type: "PAYMENT", date: "2025-06-01", entries: [] } });
      const res = makeMockRes();

      await createVoucher(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
