import { Router } from "express";
import { UserRole } from "@prisma/client";
import { getFeeCategories, getFeeCategoryById, createFeeCategory, updateFeeCategory, toggleFeeCategory, deleteFeeCategory } from "../controllers/feeCategory.controller";
import { createFeeStructure, bulkCreateFeeStructure, getFeeStructures, getFeeStructureById, updateFeeStructure, deleteFeeStructure } from "../controllers/feeStructure.controller";
import { bulkAssignFees, assignFeesToStudents, assignTransportFee, assignTransportFeeToStudents, getStudentPendingFees, collectPayment, getStudentPayments, waiveLateFee, createRefund, sendFeeRemindersHandler } from "../controllers/feeCollection.controller";
import { createRazorpayOrder, verifyRazorpayPayment, razorpayWebhook } from "../controllers/payment.controller";
import { getPaymentReceiptPdf } from "../controllers/document.controller";
import { assignDiscount, bulkAssignDiscount, getAllDiscounts, getStudentDiscounts, getDiscountById, toggleDiscount, deleteDiscount, respondToDiscountApproval } from "../controllers/discount.controller";
import { getCollectionDayBook, getDefaultersList, getClassWiseSummary, getFeeCollectionTrend, getPaymentModeBreakdown, exportDefaultersCsv } from "../controllers/feeReports.controller";
import { authenticate, authorize, branchAccess } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  collectPaymentSchema, createRefundSchema, bulkAssignFeesSchema, assignFeesToStudentsSchema,
  assignTransportFeeSchema, assignTransportFeeToStudentsSchema, createRazorpayOrderSchema, verifyRazorpayPaymentSchema,
  bulkCreateFeeStructureSchema,
} from "../validators/fee.validator";
import { assignDiscountSchema, bulkAssignDiscountSchema, respondToDiscountApprovalSchema } from "../validators/discount.validator";

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
router.get("/categories/:id", getFeeCategoryById);
router.post("/categories", authorize(...ADMIN), branchAccess, createFeeCategory);
router.put("/categories/:id", authorize(...ADMIN), updateFeeCategory);
router.patch("/categories/:id/toggle", authorize(...ADMIN), toggleFeeCategory);
router.delete("/categories/:id", authorize(...ADMIN), deleteFeeCategory);

// Fee Structure
router.get("/structures", authorize(...FINANCE), getFeeStructures);
router.get("/structures/:id", authorize(...FINANCE), getFeeStructureById);
router.post("/structures", authorize(...ADMIN), branchAccess, createFeeStructure);
router.post("/structures/bulk", authorize(...ADMIN), branchAccess, validate(bulkCreateFeeStructureSchema), bulkCreateFeeStructure);
router.put("/structures/:id", authorize(...ADMIN), updateFeeStructure);
router.delete("/structures/:id", authorize(...ADMIN), deleteFeeStructure);

// Fee Assignment
router.post("/assign/bulk", authorize(...ADMIN), validate(bulkAssignFeesSchema), bulkAssignFees);
router.post("/assign/students", authorize(...ADMIN), validate(assignFeesToStudentsSchema), assignFeesToStudents);
router.post("/assign/transport", authorize(...ADMIN), validate(assignTransportFeeSchema), assignTransportFee);
router.post("/assign/transport/students", authorize(...ADMIN), validate(assignTransportFeeToStudentsSchema), assignTransportFeeToStudents);

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
// Branch-wide list ("who has a discount at all") - registered before
// the "/:studentId" route below so "/discounts" (no param) is never
// swallowed as a studentId (it isn't, since Express matches on path
// SHAPE not just prefix, but kept in this order to match this file's
// existing "specific static route before param route" convention).
router.get("/discounts", authorize(...FINANCE), getAllDiscounts);
// One-discount detail view - registered before "/:studentId" for the
// same "specific static-ish route before the param route" reasoning
// as this file's existing convention (see the /discounts comment
// above); an id and a studentId are both opaque cuid strings so
// there's no ambiguity risk either way, but this keeps the ordering
// consistent with the rest of the file.
router.get("/discounts/detail/:id", authorize(...FINANCE), getDiscountById);
router.get("/discounts/:studentId", authorize(...FINANCE), getStudentDiscounts);
router.post("/discounts", authorize(...ADMIN), validate(assignDiscountSchema), assignDiscount);
router.post("/discounts/bulk", authorize(...ADMIN), validate(bulkAssignDiscountSchema), bulkAssignDiscount);
router.patch("/discounts/:id/toggle", authorize(...ADMIN), toggleDiscount);
router.delete("/discounts/:id", authorize(...ADMIN), deleteDiscount);
// Sibling discount Principal-approval gate (spec Section 19)
router.patch("/discounts/:id/respond", authorize(...ADMIN, UserRole.PRINCIPAL, UserRole.VICE_PRINCIPAL), validate(respondToDiscountApprovalSchema), respondToDiscountApproval);

// Reports
router.get("/reports/daybook", authorize(...FINANCE), getCollectionDayBook);
router.get("/reports/defaulters", authorize(...FINANCE), getDefaultersList);
router.get("/reports/class-summary", authorize(...FINANCE), getClassWiseSummary);
router.get("/reports/collection-trend", authorize(...FINANCE), getFeeCollectionTrend);
router.get("/reports/payment-mode-breakdown", authorize(...FINANCE), getPaymentModeBreakdown);
router.get("/reports/defaulters/export", authorize(...FINANCE), exportDefaultersCsv);

// Reminders (Phase 1 - Communication)
router.post("/reminders/send", authorize(...FINANCE), sendFeeRemindersHandler);

export default router;
