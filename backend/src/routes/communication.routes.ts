import { Router } from "express";
import { UserRole } from "@prisma/client";
import { createNotice, getNotices, deleteNotice, togglePin } from "../controllers/notice.controller";
import { sendMessage, getConversation, getInbox } from "../controllers/message.controller";
import { createTemplate, getTemplates, generateCertificate, getGeneratedCertificates, verifyCertificate } from "../controllers/certificate.controller";
import { getMyNotifications } from "../controllers/notification.controller";
import { registerDeviceToken, unregisterDeviceToken } from "../controllers/deviceToken.controller";
import { authenticate, authorize, branchAccess } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { generateCertificateSchema } from "../validators/certificate.validator";
import { createNoticeSchema } from "../validators/notice.validator";

const router = Router();
const ADMIN = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN];
const STAFF = [...ADMIN, UserRole.TEACHER, UserRole.ACCOUNTANT, UserRole.LIBRARIAN, UserRole.TRANSPORT_MANAGER, UserRole.WARDEN, UserRole.STAFF];

// PUBLIC - no authenticate() on purpose, so a bank/employer/other
// school holding a printed certificate can verify it without needing a
// school-portal login. Returns only minimal info already printed on
// the certificate itself (see certificate.controller.ts's doc comment).
router.get("/certificates/verify/:serialNo", verifyCertificate);

router.use(authenticate);

// === NOTIFICATIONS (self-service) ===
router.get("/notifications", getMyNotifications);
router.post("/notifications/devices/register", registerDeviceToken);
router.delete("/notifications/devices/:token", unregisterDeviceToken);

// === NOTICES ===
router.post("/notices", authorize(...STAFF), branchAccess, validate(createNoticeSchema), createNotice);
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
router.post("/certificates/generate", authorize(...ADMIN), validate(generateCertificateSchema), generateCertificate);
router.get("/certificates/generated", authorize(...ADMIN), getGeneratedCertificates);

export default router;
