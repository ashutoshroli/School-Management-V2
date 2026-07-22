import { Router } from "express";
import { UserRole } from "@prisma/client";
import { requestRoomBooking, getRoomBookings, respondToRoomBooking, cancelRoomBooking } from "../controllers/roomBooking.controller";
import { authenticate, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { requestRoomBookingSchema, respondToRoomBookingSchema } from "../validators/roomBooking.validator";

const router = Router();
const ADMIN = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN];
const STAFF_ROLES = [...ADMIN, UserRole.PRINCIPAL, UserRole.VICE_PRINCIPAL, UserRole.TEACHER, UserRole.ACCOUNTANT, UserRole.LIBRARIAN, UserRole.TRANSPORT_MANAGER, UserRole.WARDEN, UserRole.STAFF];
// Only Principal (per spec) + Admin roles can approve/reject a booking.
const APPROVERS = [...ADMIN, UserRole.PRINCIPAL, UserRole.VICE_PRINCIPAL];

router.use(authenticate);

router.post("/", authorize(...STAFF_ROLES), validate(requestRoomBookingSchema), requestRoomBooking);
router.get("/", authorize(...STAFF_ROLES), getRoomBookings);
router.patch("/:id/respond", authorize(...APPROVERS), validate(respondToRoomBookingSchema), respondToRoomBooking);
router.patch("/:id/cancel", authorize(...STAFF_ROLES), cancelRoomBooking);

export default router;
