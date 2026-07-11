import { Router } from "express";
import { UserRole } from "@prisma/client";
import { getFeeCategories, createFeeCategory, updateFeeCategory, toggleFeeCategory } from "../controllers/feeCategory.controller";
import { createFeeStructure, getFeeStructures, updateFeeStructure, deleteFeeStructure } from "../controllers/feeStructure.controller";
import { bulkAssignFees, getStudentPendingFees, collectPayment, getStudentPayments, waiveLateFee, createRefund, sendFeeRemindersHandler } from "../controllers/feeCollection.controller";
import { createRazorpayOrder, verifyRazorpayPayment, razorpayWebhook } from "../controllers/payment.controller";
import { getPaymentReceiptPdf } from "../controllers/document.controller";
import { assignDiscount, getStudentDiscounts, toggleDiscount, deleteDiscount } from "../controllers/discount.controller";
import { getCollectionDayBook, getDefaultersList, getClassWiseSummary } from "../controllers/feeReports.controller";
import { authenticate, authorize, branchAccess } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  collectPaymentSchema, createRefundSchema, bulkAssignFeesSchema,
  createRazorpayOrderSchema, verifyRazorpayPaymentSchema,
} from "../validators/fee.validator";

const router = Router();
const ADMIN = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN];
const FINANCE = [...ADMIN, UserRole.ACCOUNTANT];

// Razorpay webhook - Razorpay's servers call this directly, they cannot
// send our JWT, and the request is authenticated via HMAC signature
// verification inside the controller instead. Must be mounted BEFORE
// `router.use(authenticate)` below.
router.post("/razorpay/webhook", razorpayWebhook);

router.use(authenticate);

// Fee Categories
router.get("/categories", getFeeCategories);
router.post("/categories", authorize(...ADMIN), branchAccess, createFeeCategory);
router.put("/categories/:id", authorize(...ADMIN), updateFeeCategory);
router.patch("/categories/:id/toggle", authorize(...ADMIN), toggleFeeCategory);

// Fee Structure
router.get("/structures", authorize(...FINANCE), getFeeStructures);
router.post("/structures", authorize(...ADMIN), branchAccess, createFeeStructure);
router.put("/structures/:id", authorize(...ADMIN), updateFeeStructure);
router.delete("/structures/:id", authorize(...ADMIN), deleteFeeStructure);

// Fee Assignment
router.post("/assign/bulk", authorize(...ADMIN), validate(bulkAssignFeesSchema), bulkAssignFees);

// Finance staff (to collect on a student's behalf) or the STUDENT/PARENT
// themselves (self-service). canAccessStudentRecord inside each
// controller further restricts STUDENT/PARENT to their own
// record/children.
const PAYERS = [...FINANCE, UserRole.STUDENT, UserRole.PARENT];

// Fee Collection
router.get("/pending/:studentId", authorize(...PAYERS), getStudentPendingFees);
router.post("/collect", authorize(...FINANCE), branchAccess, validate(collectPaymentSchema), collectPayment);
router.get("/payments/:studentId", authorize(...PAYERS), getStudentPayments);
router.get("/payments/:id/receipt", authorize(...PAYERS), getPaymentReceiptPdf);
router.patch("/waive-late-fee/:id", authorize(...ADMIN), waiveLateFee);

// Online payments (Razorpay) - branchAccess enforces branch scoping.
router.post("/razorpay/order", authorize(...PAYERS), branchAccess, validate(createRazorpayOrderSchema), createRazorpayOrder);
router.post("/razorpay/verify", authorize(...PAYERS), branchAccess, validate(verifyRazorpayPaymentSchema), verifyRazorpayPayment);

// Refund
router.post("/refund", authorize(...ADMIN), validate(createRefundSchema), createRefund);

// Discounts
router.get("/discounts/:studentId", authorize(...FINANCE), getStudentDiscounts);
router.post("/discounts", authorize(...ADMIN), assignDiscount);
router.patch("/discounts/:id/toggle", authorize(...ADMIN), toggleDiscount);
router.delete("/discounts/:id", authorize(...ADMIN), deleteDiscount);

// Reports
router.get("/reports/daybook", authorize(...FINANCE), getCollectionDayBook);
router.get("/reports/defaulters", authorize(...FINANCE), getDefaultersList);
router.get("/reports/class-summary", authorize(...FINANCE), getClassWiseSummary);

// Reminders (Phase 1 - Communication)
router.post("/reminders/send", authorize(...FINANCE), sendFeeRemindersHandler);

export default router;
