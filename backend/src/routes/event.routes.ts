import { Router } from "express";
import { UserRole } from "@prisma/client";
import { createEvent, getEvents, getEventById, updateEvent, deleteEvent, rsvpEvent } from "../controllers/event.controller";
import { authenticate, authorize } from "../middleware/auth";

const router = Router();
const ADMIN = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN];
const STAFF = [...ADMIN, UserRole.TEACHER, UserRole.ACCOUNTANT, UserRole.LIBRARIAN, UserRole.TRANSPORT_MANAGER, UserRole.WARDEN, UserRole.STAFF];

router.use(authenticate);

// Event CRUD
router.post("/", authorize(...ADMIN), createEvent);
router.get("/", getEvents);
router.get("/:id", getEventById);
router.put("/:id", authorize(...ADMIN), updateEvent);
router.delete("/:id", authorize(...ADMIN), deleteEvent);

// RSVP
router.post("/:id/rsvp", authorize(...STAFF, UserRole.STUDENT, UserRole.PARENT), rsvpEvent);

export default router;
