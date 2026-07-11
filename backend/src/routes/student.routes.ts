import { Router } from "express";
import { UserRole } from "@prisma/client";
import { createStudent, getStudents, getStudentById, updateStudent, deleteStudent, resetStudentPassword } from "../controllers/student.controller";
import { getStudentIdCardPdf, getClassIdCardsBatchPdf } from "../controllers/document.controller";
import { uploadStudentDocument, deleteStudentDocument } from "../controllers/upload.controller";
import { authenticate, authorize, branchAccess } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { uploadDocument, handleUploadErrors } from "../middleware/upload";
import { createStudentSchema, updateStudentSchema } from "../validators/student.validator";

const router = Router();
const ADMIN = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN];

router.use(authenticate);

router.post("/", authorize(...ADMIN), branchAccess, validate(createStudentSchema), createStudent);
// TRANSPORT_MANAGER added so transport staff can search students to
// allocate onto a route (Transport > Manage Students) without needing
// full ADMIN access.
router.get("/", authorize(...ADMIN, UserRole.TEACHER, UserRole.ACCOUNTANT, UserRole.TRANSPORT_MANAGER), getStudents);
// Registered before "/:id" - "id-cards" is a distinct path segment so
// there's no actual routing ambiguity with the :id param below, but
// keeping the more specific static route first matches this file's
// existing convention and avoids any confusion when skimming the list.
router.get("/id-cards/batch", authorize(...ADMIN, UserRole.TEACHER), getClassIdCardsBatchPdf);
router.get("/:id", getStudentById);
router.get("/:id/id-card", getStudentIdCardPdf);
router.put("/:id", authorize(...ADMIN), validate(updateStudentSchema), updateStudent);
router.post("/:id/reset-password", authorize(...ADMIN), resetStudentPassword);
router.delete("/:id", authorize(...ADMIN), deleteStudent);

// Documents (photo, birth certificate, TC, etc). Upload/delete restricted
// to branch admin staff; the student/parent can only view via
// getStudentById (documents are included there).
router.post("/:id/documents", authorize(...ADMIN), handleUploadErrors(uploadDocument), uploadStudentDocument);
router.delete("/:studentId/documents/:docId", authorize(...ADMIN), deleteStudentDocument);

export default router;
