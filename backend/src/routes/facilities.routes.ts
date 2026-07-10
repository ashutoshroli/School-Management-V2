import { Router } from "express";
import { UserRole } from "@prisma/client";
import { addBook, getBooks, issueBook, returnBook, getIssuedBooks } from "../controllers/library.controller";
import { addItem, getItems, purchaseStock, issueStock, getLowStockAlerts } from "../controllers/inventory.controller";
import { createRoute, getRoutes, addStop, allocateStudent, getVehicles, addVehicle } from "../controllers/transport.controller";
import { createBuilding, getBuildings, addFloor, addRoom, allocateRoom, deallocateRoom, getOccupancy } from "../controllers/hostel.controller";
import { authenticate, authorize } from "../middleware/auth";

const router = Router();
const ADMIN = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN];

router.use(authenticate);

// === LIBRARY ===
router.post("/library/books", authorize(...ADMIN, UserRole.LIBRARIAN), addBook);
router.get("/library/books", getBooks);
router.post("/library/issue", authorize(...ADMIN, UserRole.LIBRARIAN), issueBook);
router.patch("/library/return/:id", authorize(...ADMIN, UserRole.LIBRARIAN), returnBook);
router.get("/library/issued", authorize(...ADMIN, UserRole.LIBRARIAN), getIssuedBooks);

// === INVENTORY ===
router.post("/inventory/items", authorize(...ADMIN), addItem);
router.get("/inventory/items", authorize(...ADMIN), getItems);
router.post("/inventory/purchase", authorize(...ADMIN), purchaseStock);
router.post("/inventory/issue", authorize(...ADMIN), issueStock);
router.get("/inventory/low-stock", authorize(...ADMIN), getLowStockAlerts);

// === TRANSPORT ===
router.post("/transport/routes", authorize(...ADMIN, UserRole.TRANSPORT_MANAGER), createRoute);
router.get("/transport/routes", getRoutes);
router.post("/transport/stops", authorize(...ADMIN, UserRole.TRANSPORT_MANAGER), addStop);
router.post("/transport/allocate", authorize(...ADMIN, UserRole.TRANSPORT_MANAGER), allocateStudent);
router.get("/transport/vehicles", getVehicles);
router.post("/transport/vehicles", authorize(...ADMIN, UserRole.TRANSPORT_MANAGER), addVehicle);

// === HOSTEL ===
router.post("/hostel/buildings", authorize(...ADMIN, UserRole.WARDEN), createBuilding);
router.get("/hostel/buildings", getBuildings);
router.post("/hostel/floors", authorize(...ADMIN, UserRole.WARDEN), addFloor);
router.post("/hostel/rooms", authorize(...ADMIN, UserRole.WARDEN), addRoom);
router.post("/hostel/allocate", authorize(...ADMIN, UserRole.WARDEN), allocateRoom);
router.patch("/hostel/deallocate/:id", authorize(...ADMIN, UserRole.WARDEN), deallocateRoom);
router.get("/hostel/occupancy", getOccupancy);

export default router;
