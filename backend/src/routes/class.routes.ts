import { Router } from "express";
import { UserRole } from "@prisma/client";
import {
  createClass, getClasses, updateClass, deleteClass,
  createSection, getSections, updateSection, deleteSection,
  createSubject, getSubjects, updateSubject, deleteSubject,
  assignSubjectToClass, getClassSubjects, removeSubjectFromClass,
} from "../controllers/class.controller";
import { authenticate, authorize } from "../middleware/auth";

const router = Router();
const ADMIN = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN];

router.use(authenticate);

// Classes
router.post("/", authorize(...ADMIN), createClass);
router.get("/", getClasses);
router.put("/:id", authorize(...ADMIN), updateClass);
router.delete("/:id", authorize(...ADMIN), deleteClass);

// Sections
router.post("/sections", authorize(...ADMIN), createSection);
router.get("/sections", getSections);
router.put("/sections/:id", authorize(...ADMIN), updateSection);
router.delete("/sections/:id", authorize(...ADMIN), deleteSection);

// Subjects
router.post("/subjects", authorize(...ADMIN), createSubject);
router.get("/subjects", getSubjects);
router.put("/subjects/:id", authorize(...ADMIN), updateSubject);
router.delete("/subjects/:id", authorize(...ADMIN), deleteSubject);

// Class-Subject mapping
router.post("/subjects/assign", authorize(...ADMIN), assignSubjectToClass);
router.get("/:classId/subjects", getClassSubjects);
router.delete("/subjects/mapping/:id", authorize(...ADMIN), removeSubjectFromClass);

export default router;
