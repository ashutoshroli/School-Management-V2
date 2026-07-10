import { Router } from "express";
import { UserRole } from "@prisma/client";
import { createNotice, getNotices, deleteNotice, togglePin } from "../controllers/notice.controller";
import { sendMessage, getConversation, getInbox } from "../controllers/message.controller";
import { createTemplate, getTemplates, generateCertificate, getGeneratedCertificates } from "../controllers/certificate.controller";
import { authenticate, authorize, branchAccess } from "../middleware/auth";

const router = Router();
const ADMIN = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN];
const STAFF = [...ADMIN, UserRole.TEACHER, UserRole.ACCOUNTANT, UserRole.LIBRARIAN, UserRole.TRANSPORT_MANAGER, UserRole.WARDEN, UserRole.STAFF];

router.use(authenticate);

// === NOTICES ===
router.post("/notices", authorize(...STAFF), branchAccess, createNotice);
router.get("/notices", getNotices);
router.delete("/notices/:id", authorize(...ADMIN), deleteNotice);
router.patch("/notices/:id/pin", authorize(...ADMIN), togglePin);

// === MESSAGES (Parent-Teacher) ===
router.post("/messages", sendMessage);
router.get("/messages/inbox", getInbox);
router.get("/messages/:userId", getConversation);

// === CERTIFICATES ===
router.post("/certificates/templates", authorize(...ADMIN), createTemplate);
router.get("/certificates/templates", authorize(...ADMIN), getTemplates);
router.post("/certificates/generate", authorize(...ADMIN), generateCertificate);
router.get("/certificates/generated", authorize(...ADMIN), getGeneratedCertificates);

export default router;
