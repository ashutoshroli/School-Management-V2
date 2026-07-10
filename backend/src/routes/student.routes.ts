import { Router } from "express";
import { UserRole } from "@prisma/client";
import { createStudent, getStudents, getStudentById, updateStudent } from "../controllers/student.controller";
import { authenticate, authorize } from "../middleware/auth";

const router = Router();
const ADMIN = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN];

router.use(authenticate);

router.post("/", authorize(...ADMIN), createStudent);
router.get("/", authorize(...ADMIN, UserRole.TEACHER, UserRole.ACCOUNTANT), getStudents);
router.get("/:id", getStudentById);
router.put("/:id", authorize(...ADMIN), updateStudent);

export default router;
