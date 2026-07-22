import { Router } from "express";
import { UserRole } from "@prisma/client";
import { addLabEquipment, getLabEquipment, issueLabEquipment, returnLabEquipment, waiveLabDamageFine, getExpiringConsumables } from "../controllers/lab.controller";
import { authenticate, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { addLabEquipmentSchema, issueLabEquipmentSchema, returnLabEquipmentSchema, waiveLabDamageFineSchema } from "../validators/lab.validator";

const router = Router();
const ADMIN = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN];
// "Lab Assistant" has no dedicated UserRole in this codebase (it's
// just a free-text customStaffType label under STAFF, see
// staff.controller.ts) - STAFF + TEACHER can act as lab assistant.
const LAB_STAFF = [...ADMIN, UserRole.STAFF, UserRole.TEACHER];

router.use(authenticate);

router.post("/equipment", authorize(...LAB_STAFF), validate(addLabEquipmentSchema), addLabEquipment);
router.get("/equipment", authorize(...LAB_STAFF, UserRole.STUDENT), getLabEquipment);
router.get("/equipment/expiring", authorize(...LAB_STAFF), getExpiringConsumables);

router.post("/issue", authorize(...LAB_STAFF), validate(issueLabEquipmentSchema), issueLabEquipment);
router.patch("/issue/:id/return", authorize(...LAB_STAFF), validate(returnLabEquipmentSchema), returnLabEquipment);
// Damage/breakage fine waiver restricted to Principal per spec Section 16.
router.patch("/issue/:id/waive", authorize(...ADMIN, UserRole.PRINCIPAL, UserRole.VICE_PRINCIPAL), validate(waiveLabDamageFineSchema), waiveLabDamageFine);

export default router;
