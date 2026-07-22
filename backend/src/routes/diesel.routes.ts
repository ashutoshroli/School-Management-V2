import { Router } from "express";
import { UserRole } from "@prisma/client";
import { raiseDieselRequest, getDieselRequests, advanceDieselRequest } from "../controllers/diesel.controller";
import { authenticate, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { raiseDieselRequestSchema, advanceDieselRequestSchema } from "../validators/diesel.validator";

const router = Router();
const ADMIN = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN];
// Approval-chain actors: Transport Manager, Accountant, Director
// (BRANCH_ADMIN/SUPER_ADMIN) - spec Section 11.
const CHAIN_ACTORS = [...ADMIN, UserRole.TRANSPORT_MANAGER, UserRole.ACCOUNTANT];

router.use(authenticate);

router.post("/", authorize(...CHAIN_ACTORS, UserRole.STAFF), validate(raiseDieselRequestSchema), raiseDieselRequest);
router.get("/", authorize(...CHAIN_ACTORS), getDieselRequests);
router.patch("/:id/advance", authorize(...CHAIN_ACTORS), validate(advanceDieselRequestSchema), advanceDieselRequest);

export default router;
