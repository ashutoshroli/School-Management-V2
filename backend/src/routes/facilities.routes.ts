import { Router } from "express";
import { UserRole } from "@prisma/client";
import { addBook, getBooks, issueBook, returnBook, getIssuedBooks, deleteBook } from "../controllers/library.controller";
import { addItem, getItems, purchaseStock, issueStock, getLowStockAlerts, deleteItem } from "../controllers/inventory.controller";
import { createRoute, getRoutes, addStop, allocateStudent, getVehicles, addVehicle, deleteVehicle, deleteRoute } from "../controllers/transport.controller";
import { createBuilding, getBuildings, addFloor, addRoom, allocateRoom, deallocateRoom, getOccupancy, deleteBuilding } from "../controllers/hostel.controller";
import { createDevice, getDevices, updateDevice, regenerateApiKey, deleteDevice } from "../controllers/attendanceDevice.controller";
import { authenticate, authorize, branchAccess } from "../middleware/auth";

const router = Router();
const ADMIN = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN];

router.use(authenticate);

// === LIBRARY ===
router.post("/library/books", authorize(...ADMIN, UserRole.LIBRARIAN), branchAccess, addBook);
router.get("/library/books", getBooks);
router.post("/library/issue", authorize(...ADMIN, UserRole.LIBRARIAN), issueBook);
router.patch("/library/return/:id", authorize(...ADMIN, UserRole.LIBRARIAN), returnBook);
router.get("/library/issued", authorize(...ADMIN, UserRole.LIBRARIAN), getIssuedBooks);
router.delete("/library/books/:id", authorize(...ADMIN, UserRole.LIBRARIAN), deleteBook);

// === INVENTORY ===
router.post("/inventory/items", authorize(...ADMIN), branchAccess, addItem);
router.get("/inventory/items", authorize(...ADMIN), getItems);
router.post("/inventory/purchase", authorize(...ADMIN), purchaseStock);
router.post("/inventory/issue", authorize(...ADMIN), issueStock);
router.get("/inventory/low-stock", authorize(...ADMIN), getLowStockAlerts);
router.delete("/inventory/items/:id", authorize(...ADMIN), deleteItem);

// === TRANSPORT ===
router.post("/transport/routes", authorize(...ADMIN, UserRole.TRANSPORT_MANAGER), branchAccess, createRoute);
router.get("/transport/routes", getRoutes);
router.post("/transport/stops", authorize(...ADMIN, UserRole.TRANSPORT_MANAGER), addStop);
router.post("/transport/allocate", authorize(...ADMIN, UserRole.TRANSPORT_MANAGER), allocateStudent);
router.get("/transport/vehicles", getVehicles);
router.post("/transport/vehicles", authorize(...ADMIN, UserRole.TRANSPORT_MANAGER), branchAccess, addVehicle);
router.delete("/transport/vehicles/:id", authorize(...ADMIN, UserRole.TRANSPORT_MANAGER), deleteVehicle);
router.delete("/transport/routes/:id", authorize(...ADMIN, UserRole.TRANSPORT_MANAGER), deleteRoute);

// === HOSTEL ===
router.post("/hostel/buildings", authorize(...ADMIN, UserRole.WARDEN), branchAccess, createBuilding);
router.get("/hostel/buildings", getBuildings);
router.post("/hostel/floors", authorize(...ADMIN, UserRole.WARDEN), addFloor);
router.post("/hostel/rooms", authorize(...ADMIN, UserRole.WARDEN), addRoom);
router.post("/hostel/allocate", authorize(...ADMIN, UserRole.WARDEN), allocateRoom);
router.patch("/hostel/deallocate/:id", authorize(...ADMIN, UserRole.WARDEN), deallocateRoom);
router.get("/hostel/occupancy", getOccupancy);
router.delete("/hostel/buildings/:id", authorize(...ADMIN, UserRole.WARDEN), deleteBuilding);

// === ATTENDANCE DEVICES (RFID/card-tap readers) - Phase 5 ===
router.post("/attendance-devices", authorize(...ADMIN), branchAccess, createDevice);
router.get("/attendance-devices", authorize(...ADMIN), getDevices);
router.patch("/attendance-devices/:id", authorize(...ADMIN), updateDevice);
router.post("/attendance-devices/:id/regenerate-key", authorize(...ADMIN), regenerateApiKey);
router.delete("/attendance-devices/:id", authorize(...ADMIN), deleteDevice);

export default router;
