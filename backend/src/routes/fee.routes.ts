import { Router } from "express";
import { UserRole } from "@prisma/client";
import { getFeeCategories, createFeeCategory, updateFeeCategory, toggleFeeCategory } from "../controllers/feeCategory.controller";
import { createFeeStructure, getFeeStructures, updateFeeStructure, deleteFeeStructure } from "../controllers/feeStructure.controller";
import { bulkAssignFees, getStudentPendingFees, collectPayment, getStudentPayments, waiveLateFee, createRefund } from "../controllers/feeCollection.controller";
import { assignDiscount, getStudentDiscounts, toggleDiscount, deleteDiscount } from "../controllers/discount.controller";
import { getCollectionDayBook, getDefaultersList, getClassWiseSummary } from "../controllers/feeReports.controller";
import { authenticate, authorize, branchAccess } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { collectPaymentSchema, createRefundSchema, bulkAssignFeesSchema } from "../validators/fee.validator";

const router = Router();
const ADMIN = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN];
const FINANCE = [...ADMIN, UserRole.ACCOUNTANT];

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

// Fee Collection
router.get("/pending/:studentId", authorize(...FINANCE), getStudentPendingFees);
router.post("/collect", authorize(...FINANCE), branchAccess, validate(collectPaymentSchema), collectPayment);
router.get("/payments/:studentId", authorize(...FINANCE), getStudentPayments);
router.patch("/waive-late-fee/:id", authorize(...ADMIN), waiveLateFee);

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

export default router;
