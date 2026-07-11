import { Router } from "express";
import { UserRole } from "@prisma/client";
import { createStaff, getStaffList, getStaffById, updateStaff, deleteStaff } from "../controllers/staff.controller";
import { getStaffIdCardPdf } from "../controllers/document.controller";
import { uploadStaffDocument, deleteStaffDocument } from "../controllers/upload.controller";
import { authenticate, authorize, branchAccess } from "../middleware/auth";
import { uploadDocument, handleUploadErrors } from "../middleware/upload";

const router = Router();
const ADMIN = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN];

router.use(authenticate);

router.post("/", authorize(...ADMIN), branchAccess, createStaff);
router.get("/", authorize(...ADMIN), getStaffList);
router.get("/:id", getStaffById);
// No role restriction beyond authenticate() - getStaffIdCardPdf itself
// allows either branch-admin staff OR the staff member downloading
// their own card (isSelf check inside the controller).
router.get("/:id/id-card", getStaffIdCardPdf);
router.put("/:id", authorize(...ADMIN), updateStaff);
router.delete("/:id", authorize(...ADMIN), deleteStaff);

router.post("/:id/documents", authorize(...ADMIN), handleUploadErrors(uploadDocument), uploadStaffDocument);
router.delete("/:staffId/documents/:docId", authorize(...ADMIN), deleteStaffDocument);

export default router;
