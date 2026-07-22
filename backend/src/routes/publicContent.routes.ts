import { Router } from "express";
import { UserRole } from "@prisma/client";
import { uploadGalleryImage, getGalleryImages, deleteGalleryImage, upsertRequirementsPage, getRequirementsPageAdmin, getFeedbackList, reviewFeedback } from "../controllers/publicContent.controller";
import { authenticate, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { uploadGalleryImageSchema, upsertRequirementsPageSchema, reviewFeedbackSchema } from "../validators/publicContent.validator";

const router = Router();
const ADMIN = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN];

router.use(authenticate);

router.post("/gallery", authorize(...ADMIN), validate(uploadGalleryImageSchema), uploadGalleryImage);
router.get("/gallery", authorize(...ADMIN), getGalleryImages);
router.delete("/gallery/:id", authorize(...ADMIN), deleteGalleryImage);

router.put("/requirements", authorize(...ADMIN), validate(upsertRequirementsPageSchema), upsertRequirementsPage);
router.get("/requirements", authorize(...ADMIN), getRequirementsPageAdmin);

router.get("/feedback", authorize(...ADMIN), getFeedbackList);
router.patch("/feedback/:id/review", authorize(...ADMIN), validate(reviewFeedbackSchema), reviewFeedback);

export default router;
