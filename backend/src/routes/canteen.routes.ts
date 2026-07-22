import { Router } from "express";
import { UserRole } from "@prisma/client";
import { addCanteenItem, getCanteenItems, rechargeWallet, getWallet, createCanteenSale, raiseCanteenStockRequest, advanceCanteenStockRequest, getCanteenStockRequests } from "../controllers/canteen.controller";
import { authenticate, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { addCanteenItemSchema, rechargeWalletSchema, createCanteenSaleSchema, raiseCanteenStockRequestSchema, advanceCanteenStockRequestSchema } from "../validators/canteen.validator";

const router = Router();
const ADMIN = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN];
const CANTEEN_STAFF = [...ADMIN, UserRole.ACCOUNTANT, UserRole.STAFF];

router.use(authenticate);

router.post("/items", authorize(...CANTEEN_STAFF), validate(addCanteenItemSchema), addCanteenItem);
router.get("/items", authorize(...CANTEEN_STAFF, UserRole.STUDENT, UserRole.PARENT), getCanteenItems);

router.post("/wallet/recharge", authorize(...CANTEEN_STAFF, UserRole.STUDENT, UserRole.PARENT), validate(rechargeWalletSchema), rechargeWallet);
router.get("/wallet/:studentId", authorize(...CANTEEN_STAFF, UserRole.STUDENT, UserRole.PARENT), getWallet);

router.post("/sale", authorize(...CANTEEN_STAFF), validate(createCanteenSaleSchema), createCanteenSale);

router.post("/stock-requests", authorize(...CANTEEN_STAFF), validate(raiseCanteenStockRequestSchema), raiseCanteenStockRequest);
router.get("/stock-requests", authorize(...CANTEEN_STAFF), getCanteenStockRequests);
router.patch("/stock-requests/:id/advance", authorize(...CANTEEN_STAFF), validate(advanceCanteenStockRequestSchema), advanceCanteenStockRequest);

export default router;
