import { Router } from "express";
import { UserRole } from "@prisma/client";
import { createStudent, getStudents, getStudentById, updateStudent } from "../controllers/student.controller";
import { getStudentIdCardPdf } from "../controllers/document.controller";
import { uploadStudentDocument, deleteStudentDocument } from "../controllers/upload.controller";
import { authenticate, authorize, branchAccess } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { uploadDocument, handleUploadErrors } from "../middleware/upload";
import { createStudentSchema, updateStudentSchema } from "../validators/student.validator";

const router = Router();
const ADMIN = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN];

router.use(authenticate);

router.post("/", authorize(...ADMIN), branchAccess, validate(createStudentSchema), createStudent);
router.get("/", authorize(...ADMIN, UserRole.TEACHER, UserRole.ACCOUNTANT), getStudents);
router.get("/:id", getStudentById);
router.get("/:id/id-card", getStudentIdCardPdf);
router.put("/:id", authorize(...ADMIN), validate(updateStudentSchema), updateStudent);

// Documents (photo, birth certificate, TC, etc). Upload/delete restricted
// to branch admin staff; the student/parent can only view via
// getStudentById (documents are included there).
router.post("/:id/documents", authorize(...ADMIN), handleUploadErrors(uploadDocument), uploadStudentDocument);
router.delete("/:studentId/documents/:docId", authorize(...ADMIN), deleteStudentDocument);

export default router;
