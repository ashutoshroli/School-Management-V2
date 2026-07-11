jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    account: { findMany: jest.fn(), createMany: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { seedDefaultAccountsForBranch, DEFAULT_CHART_OF_ACCOUNTS } from "../defaultChartOfAccounts";

describe("seedDefaultAccountsForBranch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates every default account when the branch has none yet", async () => {
    (prisma.account.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.account.createMany as jest.Mock).mockResolvedValue({ count: DEFAULT_CHART_OF_ACCOUNTS.length });

    const result = await seedDefaultAccountsForBranch("branch-1");

    expect(result).toEqual({ created: DEFAULT_CHART_OF_ACCOUNTS.length, alreadyExisted: 0 });
    const createManyCall = (prisma.account.createMany as jest.Mock).mock.calls[0][0];
    expect(createManyCall.data).toHaveLength(DEFAULT_CHART_OF_ACCOUNTS.length);
    expect(createManyCall.data.every((a: any) => a.branchId === "branch-1" && a.isSystem === true)).toBe(true);
    // Regression anchor: Cash (1001) and Fee Income (3001) are the two
    // accounts autoPostToAccounting (feePayment.service.ts) requires -
    // make sure they're actually part of what gets created.
    expect(createManyCall.data.some((a: any) => a.code === "1001")).toBe(true);
    expect(createManyCall.data.some((a: any) => a.code === "3001")).toBe(true);
  });

  it("is idempotent - does not recreate accounts that already exist", async () => {
    (prisma.account.findMany as jest.Mock).mockResolvedValue([{ code: "1001" }, { code: "3001" }]);
    (prisma.account.createMany as jest.Mock).mockResolvedValue({ count: DEFAULT_CHART_OF_ACCOUNTS.length - 2 });

    const result = await seedDefaultAccountsForBranch("branch-1");

    expect(result.alreadyExisted).toBe(2);
    expect(result.created).toBe(DEFAULT_CHART_OF_ACCOUNTS.length - 2);
    const createManyCall = (prisma.account.createMany as jest.Mock).mock.calls[0][0];
    expect(createManyCall.data.some((a: any) => a.code === "1001")).toBe(false);
    expect(createManyCall.data.some((a: any) => a.code === "3001")).toBe(false);
  });

  it("does not call createMany at all when every default account already exists", async () => {
    (prisma.account.findMany as jest.Mock).mockResolvedValue(
      DEFAULT_CHART_OF_ACCOUNTS.map((a) => ({ code: a.code }))
    );

    const result = await seedDefaultAccountsForBranch("branch-1");

    expect(result).toEqual({ created: 0, alreadyExisted: DEFAULT_CHART_OF_ACCOUNTS.length });
    expect(prisma.account.createMany).not.toHaveBeenCalled();
  });
});
