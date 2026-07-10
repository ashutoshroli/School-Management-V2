import { Router } from "express";
import { UserRole } from "@prisma/client";
import { getMyChildren, getChildSummary } from "../controllers/parentPortal.controller";
import { authenticate, authorize } from "../middleware/auth";

const router = Router();

router.use(authenticate);
router.use(authorize(UserRole.STUDENT, UserRole.PARENT));

router.get("/children", getMyChildren);
router.get("/children/:studentId/summary", getChildSummary);

export default router;
