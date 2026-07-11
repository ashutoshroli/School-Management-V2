import { Router } from "express";
import { UserRole } from "@prisma/client";
import { getTemplatesByCategory, uploadTemplateFile, deleteTemplateFile } from "../controllers/template.controller";
import { authenticate, authorize } from "../middleware/auth";
import { uploadTemplate, handleUploadErrors } from "../middleware/upload";

const router = Router();
// Managing the master DOCX templates (certificates/receipts/payslips/
// report cards/admission forms) is an org-wide configuration action,
// not day-to-day data entry - restricted to admins, same as the
// existing certificate-template endpoints in communication.routes.ts.
const ADMIN = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN];

router.use(authenticate, authorize(...ADMIN));

router.get("/", getTemplatesByCategory);
router.post("/upload", handleUploadErrors(uploadTemplate), uploadTemplateFile);
router.delete("/:id", deleteTemplateFile);

export default router;
