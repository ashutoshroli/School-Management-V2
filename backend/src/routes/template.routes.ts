import { Router } from "express";
import { UserRole } from "@prisma/client";
import { getTemplatesByCategory, uploadTemplateFile, deleteTemplateFile, setActiveTemplate } from "../controllers/template.controller";
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
// Point 5 (Multiple Template Upload): select which of several
// uploaded templates for the same slot is the active/default one.
router.patch("/:id/activate", setActiveTemplate);
router.delete("/:id", deleteTemplateFile);

export default router;
