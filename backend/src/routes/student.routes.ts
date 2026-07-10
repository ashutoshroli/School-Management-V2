import { Router } from "express";
import { UserRole } from "@prisma/client";
import { createStudent, getStudents, getStudentById, updateStudent } from "../controllers/student.controller";
import { authenticate, authorize, branchAccess } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { createStudentSchema, updateStudentSchema } from "../validators/student.validator";

const router = Router();
const ADMIN = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN];

router.use(authenticate);

router.post("/", authorize(...ADMIN), branchAccess, validate(createStudentSchema), createStudent);
router.get("/", authorize(...ADMIN, UserRole.TEACHER, UserRole.ACCOUNTANT), getStudents);
router.get("/:id", getStudentById);
router.put("/:id", authorize(...ADMIN), validate(updateStudentSchema), updateStudent);

export default router;
