import { Router } from "express";
import { UserRole } from "@prisma/client";
import { upsertMessMenu, getMessMenus, advanceMenuApproval, generateMessBill, getMessBills, waiveMessBill, payMessBill, logGuestMeal, getGuestMeals } from "../controllers/mess.controller";
import { authenticate, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { upsertMessMenuSchema, advanceMenuApprovalSchema, generateMessBillSchema, waiveMessBillSchema, logGuestMealSchema } from "../validators/mess.validator";

const router = Router();
const ADMIN = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN];
// Menu approval chain (spec Section 14): Mess Incharge -> Warden -> Principal -> Director
const MESS_STAFF = [...ADMIN, UserRole.WARDEN, UserRole.PRINCIPAL, UserRole.VICE_PRINCIPAL, UserRole.STAFF];

router.use(authenticate);

router.post("/menu", authorize(...MESS_STAFF), validate(upsertMessMenuSchema), upsertMessMenu);
router.get("/menu", authorize(...MESS_STAFF, UserRole.STUDENT, UserRole.PARENT), getMessMenus);
router.patch("/menu/:id/advance", authorize(...MESS_STAFF), validate(advanceMenuApprovalSchema), advanceMenuApproval);

router.post("/bills", authorize(...ADMIN, UserRole.WARDEN), validate(generateMessBillSchema), generateMessBill);
router.get("/bills", authorize(...ADMIN, UserRole.WARDEN, UserRole.STUDENT, UserRole.PARENT), getMessBills);
router.patch("/bills/:id/waive", authorize(...ADMIN, UserRole.PRINCIPAL, UserRole.VICE_PRINCIPAL, UserRole.WARDEN), validate(waiveMessBillSchema), waiveMessBill);
router.patch("/bills/:id/pay", authorize(...ADMIN, UserRole.WARDEN, UserRole.ACCOUNTANT), payMessBill);

router.post("/guest-meals", authorize(...MESS_STAFF), validate(logGuestMealSchema), logGuestMeal);
router.get("/guest-meals", authorize(...ADMIN, UserRole.WARDEN), getGuestMeals);

export default router;
