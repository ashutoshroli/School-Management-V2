import { Router } from "express";
import { UserRole } from "@prisma/client";
import { createStaff, getStaffList, getStaffById, updateStaff } from "../controllers/staff.controller";
import { uploadStaffDocument, deleteStaffDocument } from "../controllers/upload.controller";
import { authenticate, authorize, branchAccess } from "../middleware/auth";
import { uploadDocument, handleUploadErrors } from "../middleware/upload";

const router = Router();
const ADMIN = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN];

router.use(authenticate);

router.post("/", authorize(...ADMIN), branchAccess, createStaff);
router.get("/", authorize(...ADMIN), getStaffList);
router.get("/:id", getStaffById);
router.put("/:id", authorize(...ADMIN), updateStaff);

router.post("/:id/documents", authorize(...ADMIN), handleUploadErrors(uploadDocument), uploadStaffDocument);
router.delete("/:staffId/documents/:docId", authorize(...ADMIN), deleteStaffDocument);

export default router;
