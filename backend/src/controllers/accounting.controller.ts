import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { resolveBranchId, resolveEffectiveBranchId, canAccessBranch } from "../utils/branchScope";

// ==================== CHART OF ACCOUNTS ====================

export const getAccounts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    if (!branchId) { sendError(res, "Branch ID required", 400); return; }

    const accounts = await prisma.account.findMany({
      where: { branchId },
      orderBy: [{ type: "asc" }, { code: "asc" }],
      include: { children: { select: { id: true, name: true, code: true, type: true } } },
    });

    sendSuccess(res, accounts, "Accounts fetched");
  } catch (error) {
    sendError(res, "Failed to fetch accounts", 500, (error as Error).message);
  }
};

export const createAccount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, code, type, parentId } = req.body;
    // BUG FIX: the "Add Account" form has no branch-picker, so
    // req.body.branchId always arrived as "" - see
    // resolveEffectiveBranchId's doc comment.
    const branchId = resolveEffectiveBranchId(req, req.body.branchId);

    if (!branchId) {
      sendError(res, "Branch ID could not be resolved - please select a branch", 400);
      return;
    }
    if (!canAccessBranch(req, branchId)) {
      sendError(res, "Access denied: branch mismatch", 403);
      return;
    }

    const existing = await prisma.account.findUnique({
      where: { branchId_code: { branchId, code } },
    });
    if (existing) { sendError(res, "Account code already exists", 400); return; }

    const account = await prisma.account.create({
      data: { branchId, name, code, type, parentId, isSystem: false, isActive: true },
    });

    sendSuccess(res, account, "Account created", 201);
  } catch (error) {
    sendError(res, "Failed to create account", 500, (error as Error).message);
  }
};

export const updateAccount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, isActive } = req.body;

    const existing = await prisma.account.findUnique({ where: { id } });
    if (!existing) { sendError(res, "Account not found", 404); return; }
    if (!canAccessBranch(req, existing.branchId)) { sendError(res, "Account not found", 404); return; }

    const updated = await prisma.account.update({
      where: { id },
      data: { ...(name && { name }), ...(isActive !== undefined && { isActive }) },
    });

    sendSuccess(res, updated, "Account updated");
  } catch (error) {
    sendError(res, "Failed to update account", 500, (error as Error).message);
  }
};

// ==================== VOUCHER ENTRY ====================

export const createVoucher = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { type, date, narration, entries } = req.body;
    // entries: [{debitAccountId, creditAccountId, amount, narration}]
    // BUG FIX: the "New Voucher" form has no branch-picker, so
    // req.body.branchId always arrived as "" - see
    // resolveEffectiveBranchId's doc comment.
    const branchId = resolveEffectiveBranchId(req, req.body.branchId);

    if (!branchId) {
      sendError(res, "Branch ID could not be resolved - please select a branch", 400);
      return;
    }
    if (!canAccessBranch(req, branchId)) {
      sendError(res, "Access denied: branch mismatch", 403);
      return;
    }

    if (!entries || entries.length === 0) {
      sendError(res, "At least one entry is required", 400); return;
    }
    if (entries.some((e: any) => !e.amount || Number(e.amount) <= 0)) {
      sendError(res, "Every voucher entry must have an amount greater than zero", 400); return;
    }

    // Calculate total
    const totalAmount = entries.reduce((sum: number, e: any) => sum + Number(e.amount), 0);

    // SAFETY: the voucher header + all of its entries must be created
    // atomically - a half-written voucher (header with no entries, or
    // some entries missing) would silently corrupt the ledger.
    const full = await prisma.$transaction(async (tx) => {
      const count = await tx.voucher.count({ where: { branchId } });
      const voucherNo = `V-${String(count + 1).padStart(6, "0")}`;

      const voucher = await tx.voucher.create({
        data: {
          branchId,
          voucherNo,
          type,
          date: new Date(date),
          narration,
          totalAmount,
          isApproved: false,
        },
      });

      await tx.voucherEntry.createMany({
        data: entries.map((entry: any) => ({
          voucherId: voucher.id,
          debitAccountId: entry.debitAccountId,
          creditAccountId: entry.creditAccountId,
          amount: entry.amount,
          narration: entry.narration,
        })),
      });

      return tx.voucher.findUnique({
        where: { id: voucher.id },
        include: {
          entries: {
            include: {
              debitAccount: { select: { name: true, code: true } },
              creditAccount: { select: { name: true, code: true } },
            },
          },
        },
      });
    });

    sendSuccess(res, full, "Voucher created", 201);
  } catch (error) {
    sendError(res, "Failed to create voucher", 500, (error as Error).message);
  }
};

export const approveVoucher = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const existing = await prisma.voucher.findUnique({ where: { id } });
    if (!existing) { sendError(res, "Voucher not found", 404); return; }
    if (!canAccessBranch(req, existing.branchId)) { sendError(res, "Voucher not found", 404); return; }

    const updated = await prisma.voucher.update({
      where: { id },
      data: { isApproved: true, approvedBy: req.user!.userId },
    });

    sendSuccess(res, updated, "Voucher approved");
  } catch (error) {
    sendError(res, "Failed to approve voucher", 500, (error as Error).message);
  }
};

// ==================== DAY BOOK ====================

export const getDayBook = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    const from = req.query.from as string;
    const to = req.query.to as string;

    if (!branchId) { sendError(res, "Branch ID required", 400); return; }

    const where: any = { branchId, isApproved: true };
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
    }

    const vouchers = await prisma.voucher.findMany({
      where,
      orderBy: { date: "desc" },
      include: {
        entries: {
          include: {
            debitAccount: { select: { name: true, code: true } },
            creditAccount: { select: { name: true, code: true } },
          },
        },
      },
    });

    sendSuccess(res, vouchers, "Day book fetched");
  } catch (error) {
    sendError(res, "Failed to fetch day book", 500, (error as Error).message);
  }
};

// ==================== LEDGER ====================

export const getLedger = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { accountId } = req.params;
    const from = req.query.from as string;
    const to = req.query.to as string;

    const dateFilter: any = {};
    if (from) dateFilter.gte = new Date(from);
    if (to) dateFilter.lte = new Date(to);

    // Get all entries where this account is debited or credited
    const debitEntries = await prisma.voucherEntry.findMany({
      where: { debitAccountId: accountId, voucher: { isApproved: true, ...(from || to ? { date: dateFilter } : {}) } },
      include: {
        voucher: { select: { voucherNo: true, date: true, narration: true } },
        creditAccount: { select: { name: true, code: true } },
      },
      orderBy: { voucher: { date: "asc" } },
    });

    const creditEntries = await prisma.voucherEntry.findMany({
      where: { creditAccountId: accountId, voucher: { isApproved: true, ...(from || to ? { date: dateFilter } : {}) } },
      include: {
        voucher: { select: { voucherNo: true, date: true, narration: true } },
        debitAccount: { select: { name: true, code: true } },
      },
      orderBy: { voucher: { date: "asc" } },
    });

    // Build ledger entries
    const ledger: any[] = [];
    let runningBalance = 0;

    const allEntries = [
      ...debitEntries.map((e) => ({ ...e, side: "DEBIT" as const, date: e.voucher.date })),
      ...creditEntries.map((e) => ({ ...e, side: "CREDIT" as const, date: e.voucher.date })),
    ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    for (const entry of allEntries) {
      const amount = Number(entry.amount);
      if (entry.side === "DEBIT") {
        runningBalance += amount;
      } else {
        runningBalance -= amount;
      }
      ledger.push({
        date: entry.date,
        voucherNo: entry.voucher.voucherNo,
        narration: entry.voucher.narration || entry.narration,
        debit: entry.side === "DEBIT" ? amount : 0,
        credit: entry.side === "CREDIT" ? amount : 0,
        balance: runningBalance,
      });
    }

    sendSuccess(res, { ledger, totalDebit: ledger.reduce((s, l) => s + l.debit, 0), totalCredit: ledger.reduce((s, l) => s + l.credit, 0), closingBalance: runningBalance }, "Ledger fetched");
  } catch (error) {
    sendError(res, "Failed to fetch ledger", 500, (error as Error).message);
  }
};

// ==================== TRIAL BALANCE ====================

export const getTrialBalance = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    if (!branchId) { sendError(res, "Branch ID required", 400); return; }

    const accounts = await prisma.account.findMany({ where: { branchId, isActive: true } });
    const accountIds = accounts.map((a) => a.id);

    // Two grouped aggregate queries instead of 2 queries per account
    // (previously N+1 - with ~50-100 accounts that was 100-200 round
    // trips per report load).
    const [debitGroups, creditGroups] = await Promise.all([
      prisma.voucherEntry.groupBy({
        by: ["debitAccountId"],
        where: { debitAccountId: { in: accountIds }, voucher: { isApproved: true } },
        _sum: { amount: true },
      }),
      prisma.voucherEntry.groupBy({
        by: ["creditAccountId"],
        where: { creditAccountId: { in: accountIds }, voucher: { isApproved: true } },
        _sum: { amount: true },
      }),
    ]);

    const debitByAccount = new Map(debitGroups.map((g) => [g.debitAccountId, Number(g._sum.amount || 0)]));
    const creditByAccount = new Map(creditGroups.map((g) => [g.creditAccountId, Number(g._sum.amount || 0)]));

    const trialBalance: any[] = [];
    let totalDebit = 0;
    let totalCredit = 0;

    for (const account of accounts) {
      const debit = debitByAccount.get(account.id) || 0;
      const credit = creditByAccount.get(account.id) || 0;
      const balance = debit - credit;

      if (debit === 0 && credit === 0) continue;

      trialBalance.push({
        accountId: account.id,
        accountName: account.name,
        accountCode: account.code,
        accountType: account.type,
        debit: balance > 0 ? balance : 0,
        credit: balance < 0 ? Math.abs(balance) : 0,
      });

      if (balance > 0) totalDebit += balance;
      else totalCredit += Math.abs(balance);
    }

    sendSuccess(res, { trialBalance, totalDebit, totalCredit }, "Trial balance fetched");
  } catch (error) {
    sendError(res, "Failed to fetch trial balance", 500, (error as Error).message);
  }
};

// ==================== PROFIT & LOSS ====================

export const getProfitAndLoss = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    if (!branchId) { sendError(res, "Branch ID required", 400); return; }

    // Income accounts (type = INCOME)
    const incomeAccounts = await prisma.account.findMany({ where: { branchId, type: "INCOME", isActive: true } });
    const expenseAccounts = await prisma.account.findMany({ where: { branchId, type: "EXPENSE", isActive: true } });

    // Single grouped aggregate per side instead of one query per account.
    const [creditGroups, debitGroups] = await Promise.all([
      prisma.voucherEntry.groupBy({
        by: ["creditAccountId"],
        where: { creditAccountId: { in: incomeAccounts.map((a) => a.id) }, voucher: { isApproved: true } },
        _sum: { amount: true },
      }),
      prisma.voucherEntry.groupBy({
        by: ["debitAccountId"],
        where: { debitAccountId: { in: expenseAccounts.map((a) => a.id) }, voucher: { isApproved: true } },
        _sum: { amount: true },
      }),
    ]);
    const creditByAccount = new Map(creditGroups.map((g) => [g.creditAccountId, Number(g._sum.amount || 0)]));
    const debitByAccount = new Map(debitGroups.map((g) => [g.debitAccountId, Number(g._sum.amount || 0)]));

    const incomeItems: any[] = [];
    let totalIncome = 0;

    for (const acc of incomeAccounts) {
      const amount = creditByAccount.get(acc.id) || 0;
      if (amount > 0) {
        incomeItems.push({ name: acc.name, code: acc.code, amount });
        totalIncome += amount;
      }
    }

    const expenseItems: any[] = [];
    let totalExpense = 0;

    for (const acc of expenseAccounts) {
      const amount = debitByAccount.get(acc.id) || 0;
      if (amount > 0) {
        expenseItems.push({ name: acc.name, code: acc.code, amount });
        totalExpense += amount;
      }
    }

    const netProfit = totalIncome - totalExpense;

    sendSuccess(res, { incomeItems, totalIncome, expenseItems, totalExpense, netProfit }, "P&L fetched");
  } catch (error) {
    sendError(res, "Failed to fetch P&L", 500, (error as Error).message);
  }
};

// ==================== BALANCE SHEET ====================

export const getBalanceSheet = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    if (!branchId) { sendError(res, "Branch ID required", 400); return; }

    const buildSection = async (type: string) => {
      const accounts = await prisma.account.findMany({ where: { branchId, type: type as any, isActive: true } });
      const accountIds = accounts.map((a) => a.id);

      const [debitGroups, creditGroups] = await Promise.all([
        prisma.voucherEntry.groupBy({
          by: ["debitAccountId"],
          where: { debitAccountId: { in: accountIds }, voucher: { isApproved: true } },
          _sum: { amount: true },
        }),
        prisma.voucherEntry.groupBy({
          by: ["creditAccountId"],
          where: { creditAccountId: { in: accountIds }, voucher: { isApproved: true } },
          _sum: { amount: true },
        }),
      ]);
      const debitByAccount = new Map(debitGroups.map((g) => [g.debitAccountId, Number(g._sum.amount || 0)]));
      const creditByAccount = new Map(creditGroups.map((g) => [g.creditAccountId, Number(g._sum.amount || 0)]));

      const items: any[] = [];
      let total = 0;

      for (const acc of accounts) {
        const balance = (debitByAccount.get(acc.id) || 0) - (creditByAccount.get(acc.id) || 0);
        if (balance !== 0) {
          items.push({ name: acc.name, code: acc.code, balance: Math.abs(balance) });
          total += Math.abs(balance);
        }
      }
      return { items, total };
    };

    const assets = await buildSection("ASSET");
    const liabilities = await buildSection("LIABILITY");
    const capital = await buildSection("CAPITAL");

    sendSuccess(res, {
      assets,
      liabilities,
      capital,
      totalLiabilitiesAndCapital: liabilities.total + capital.total,
    }, "Balance sheet fetched");
  } catch (error) {
    sendError(res, "Failed to fetch balance sheet", 500, (error as Error).message);
  }
};
