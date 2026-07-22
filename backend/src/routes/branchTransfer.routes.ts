import { Router } from "express";
import { UserRole } from "@prisma/client";
import {
  initiateStudentTransfer, respondToStudentTransfer, decideStudentTransferFeeDues,
  requestFullAcademicData, respondToFullAcademicDataRequest, completeStudentTransfer, getStudentTransfers,
  initiateStaffTransfer, respondToStaffTransfer, completeStaffTransfer, getStaffTransfers,
} from "../controllers/branchTransfer.controller";
import { authenticate, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { initiateStudentTransferSchema, respondToTransferSchema, decideFeeDuesSchema, initiateStaffTransferSchema } from "../validators/branchTransfer.validator";

const router = Router();
// Branch Transfer (spec Section 5) - initiated by Director (BRANCH_ADMIN
// /SUPER_ADMIN, direct/no-approval) or Principal/VP (needs destination
// Principal approval).
const INITIATORS = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN, UserRole.PRINCIPAL, UserRole.VICE_PRINCIPAL];

router.use(authenticate);

// Students
router.post("/students", authorize(...INITIATORS), validate(initiateStudentTransferSchema), initiateStudentTransfer);
router.get("/students", authorize(...INITIATORS), getStudentTransfers);
router.patch("/students/:id/respond", authorize(...INITIATORS), validate(respondToTransferSchema), respondToStudentTransfer);
router.patch("/students/:id/fee-dues", authorize(...INITIATORS), validate(decideFeeDuesSchema), decideStudentTransferFeeDues);
router.post("/students/:id/request-full-data", authorize(...INITIATORS), requestFullAcademicData);
router.patch("/students/:id/full-data/respond", authorize(...INITIATORS), validate(respondToTransferSchema), respondToFullAcademicDataRequest);
router.post("/students/:id/complete", authorize(...INITIATORS), completeStudentTransfer);

// Staff
router.post("/staff", authorize(...INITIATORS), validate(initiateStaffTransferSchema), initiateStaffTransfer);
router.get("/staff", authorize(...INITIATORS), getStaffTransfers);
router.patch("/staff/:id/respond", authorize(...INITIATORS), validate(respondToTransferSchema), respondToStaffTransfer);
router.post("/staff/:id/complete", authorize(...INITIATORS), completeStaffTransfer);

export default router;
