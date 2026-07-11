import { AccountType } from "@prisma/client";
import prisma from "../config/database";

/**
 * The baseline Chart of Accounts every branch needs for the app's
 * built-in flows to work - most importantly Cash (1001) and Fee Income
 * (3001), which `autoPostToAccounting` (feePayment.service.ts) requires
 * to exist before it will let a fee payment be collected at all.
 *
 * This list is the single source of truth, shared by:
 *  - db/prisma/seed.ts (demo/dev data)
 *  - seedDefaultAccountsForBranch() below, called automatically when a
 *    new branch is created (branch.controller.ts's createBranch)
 *  - POST /accounting/accounts/setup-defaults, which backfills these
 *    for a branch that was created before this fix existed (or whose
 *    accounts were deleted) - see accounting.controller.ts's
 *    setupDefaultAccounts.
 */
export const DEFAULT_CHART_OF_ACCOUNTS: { name: string; code: string; type: AccountType }[] = [
  { name: "Cash", code: "1001", type: "ASSET" },
  { name: "Bank Account", code: "1002", type: "ASSET" },
  { name: "Accounts Receivable", code: "1003", type: "ASSET" },
  { name: "Fixed Assets", code: "1004", type: "ASSET" },
  { name: "Accounts Payable", code: "2001", type: "LIABILITY" },
  { name: "Salary Payable", code: "2002", type: "LIABILITY" },
  { name: "PF Payable", code: "2003", type: "LIABILITY" },
  { name: "ESI Payable", code: "2004", type: "LIABILITY" },
  { name: "TDS Payable", code: "2005", type: "LIABILITY" },
  { name: "Fee Income", code: "3001", type: "INCOME" },
  { name: "Transport Income", code: "3002", type: "INCOME" },
  { name: "Hostel Income", code: "3003", type: "INCOME" },
  { name: "Other Income", code: "3004", type: "INCOME" },
  { name: "Salary Expense", code: "4001", type: "EXPENSE" },
  { name: "Electricity", code: "4002", type: "EXPENSE" },
  { name: "Maintenance", code: "4003", type: "EXPENSE" },
  { name: "Stationery", code: "4004", type: "EXPENSE" },
  { name: "Miscellaneous Expense", code: "4005", type: "EXPENSE" },
  { name: "Owner Capital", code: "5001", type: "CAPITAL" },
];

/**
 * Idempotently creates the default Chart of Accounts for a branch
 * (upsert on the branchId+code unique constraint - safe to call
 * repeatedly, e.g. if new default accounts are added to the list
 * above later, or as a manual backfill for a branch missing some of
 * them).
 *
 * Returns how many accounts were newly created vs already present, so
 * callers can report something more useful than a silent no-op.
 */
export const seedDefaultAccountsForBranch = async (
  branchId: string
): Promise<{ created: number; alreadyExisted: number }> => {
  const existing = await prisma.account.findMany({
    where: { branchId, code: { in: DEFAULT_CHART_OF_ACCOUNTS.map((a) => a.code) } },
    select: { code: true },
  });
  const existingCodes = new Set(existing.map((a) => a.code));
  const toCreate = DEFAULT_CHART_OF_ACCOUNTS.filter((a) => !existingCodes.has(a.code));

  if (toCreate.length > 0) {
    await prisma.account.createMany({
      data: toCreate.map((acc) => ({
        branchId,
        name: acc.name,
        code: acc.code,
        type: acc.type,
        isSystem: true,
        isActive: true,
      })),
    });
  }

  return { created: toCreate.length, alreadyExisted: existingCodes.size };
};
