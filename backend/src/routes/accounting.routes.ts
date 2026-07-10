import { Router } from "express";
import { UserRole } from "@prisma/client";
import {
  getAccounts, createAccount, updateAccount,
  createVoucher, approveVoucher,
  getDayBook, getLedger, getTrialBalance,
  getProfitAndLoss, getBalanceSheet,
} from "../controllers/accounting.controller";
import { authenticate, authorize, branchAccess } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { createAccountSchema, createVoucherSchema } from "../validators/accounting.validator";

const router = Router();
const ADMIN = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN];
const FINANCE = [...ADMIN, UserRole.ACCOUNTANT];

router.use(authenticate);

// Chart of Accounts
router.get("/accounts", authorize(...FINANCE), getAccounts);
router.post("/accounts", authorize(...ADMIN), branchAccess, validate(createAccountSchema), createAccount);
router.put("/accounts/:id", authorize(...ADMIN), updateAccount);

// Voucher Entry
router.post("/vouchers", authorize(...FINANCE), branchAccess, validate(createVoucherSchema), createVoucher);
router.patch("/vouchers/:id/approve", authorize(...ADMIN), approveVoucher);

// Day Book
router.get("/daybook", authorize(...FINANCE), getDayBook);

// Ledger
router.get("/ledger/:accountId", authorize(...FINANCE), getLedger);

// Financial Reports
router.get("/trial-balance", authorize(...FINANCE), getTrialBalance);
router.get("/profit-loss", authorize(...FINANCE), getProfitAndLoss);
router.get("/balance-sheet", authorize(...FINANCE), getBalanceSheet);

export default router;
