import { Router } from "express";
import { UserRole } from "@prisma/client";
import { submitAppraisalRating, getIncrementScreenData, enterIncrement, getSalaryIncrements, recordAttendancePerformanceRating } from "../controllers/appraisal.controller";
import { authenticate, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { submitAppraisalRatingSchema, enterIncrementSchema } from "../validators/appraisal.validator";

const router = Router();
const ADMIN = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN];

router.use(authenticate);

// Any authenticated user (student/parent/staff) submits a rating for
// the source that applies to their own role - validated in the
// controller against the `source` value.
router.post("/ratings", validate(submitAppraisalRatingSchema), submitAppraisalRating);
router.get("/increment-screen/:staffId", authorize(...ADMIN, UserRole.PRINCIPAL, UserRole.VICE_PRINCIPAL), getIncrementScreenData);
// Director (BRANCH_ADMIN) manually enters the increment % (spec Section 8)
router.post("/increment", authorize(...ADMIN), validate(enterIncrementSchema), enterIncrement);
router.get("/increment/:staffId", authorize(...ADMIN, UserRole.PRINCIPAL, UserRole.VICE_PRINCIPAL), getSalaryIncrements);
router.post("/attendance-performance", authorize(...ADMIN, UserRole.PRINCIPAL, UserRole.VICE_PRINCIPAL), recordAttendancePerformanceRating);

export default router;
