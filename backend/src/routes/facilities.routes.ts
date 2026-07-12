import { Router } from "express";
import { UserRole } from "@prisma/client";
import { addBook, getBooks, getBookById, issueBook, bulkIssueBook, returnBook, getIssuedBooks, deleteBook } from "../controllers/library.controller";
import { addItem, getItems, getItemById, purchaseStock, issueStock, getLowStockAlerts, deleteItem } from "../controllers/inventory.controller";
import { createRoute, getRoutes, addStop, allocateStudent, removeAllocation, getVehicles, getVehicleById, addVehicle, deleteVehicle, deleteRoute, assignVehicleToRoute, unassignVehicleFromRoute } from "../controllers/transport.controller";
import { createBuilding, getBuildings, addFloor, addRoom, allocateRoom, bulkAllocateRoom, deallocateRoom, getOccupancy, deleteBuilding } from "../controllers/hostel.controller";
import { createSchoolBuilding, getSchoolBuildings, addSchoolFloor, addSchoolRoom, updateSchoolRoom, deleteSchoolRoom, deleteSchoolBuilding, getSchoolOccupancySummary, bulkAddSchoolFloors, bulkAddSchoolRooms, addRoomCabin, getRoomCabins, updateRoomCabin, deleteRoomCabin } from "../controllers/schoolBuilding.controller";
import { createDevice, getDevices, updateDevice, regenerateApiKey, deleteDevice } from "../controllers/attendanceDevice.controller";
import { authenticate, authorize, branchAccess } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { addBookSchema, issueBookSchema, bulkIssueBookSchema } from "../validators/library.validator";
import { addItemSchema, purchaseStockSchema, issueStockSchema } from "../validators/inventory.validator";
import { createRouteSchema, addStopSchema, allocateStudentSchema, addVehicleSchema, assignVehicleToRouteSchema } from "../validators/transport.validator";
import { createBuildingSchema, addFloorSchema, addRoomSchema, allocateRoomSchema, bulkAllocateRoomSchema } from "../validators/hostel.validator";
import { createSchoolBuildingSchema, addSchoolFloorSchema, addSchoolRoomSchema, updateSchoolRoomSchema, bulkAddSchoolFloorsSchema, bulkAddSchoolRoomsSchema, addRoomCabinSchema, updateRoomCabinSchema } from "../validators/schoolBuilding.validator";
import { createDeviceSchema, updateDeviceSchema } from "../validators/attendanceDevice.validator";

const router = Router();
const ADMIN = [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN];

router.use(authenticate);

// === LIBRARY ===
router.post("/library/books", authorize(...ADMIN, UserRole.LIBRARIAN), branchAccess, validate(addBookSchema), addBook);
router.get("/library/books", getBooks);
router.get("/library/books/:id", getBookById);
router.post("/library/issue", authorize(...ADMIN, UserRole.LIBRARIAN), validate(issueBookSchema), issueBook);
router.post("/library/issue/bulk", authorize(...ADMIN, UserRole.LIBRARIAN), validate(bulkIssueBookSchema), bulkIssueBook);
router.patch("/library/return/:id", authorize(...ADMIN, UserRole.LIBRARIAN), returnBook);
router.get("/library/issued", authorize(...ADMIN, UserRole.LIBRARIAN), getIssuedBooks);
router.delete("/library/books/:id", authorize(...ADMIN, UserRole.LIBRARIAN), deleteBook);

// === INVENTORY ===
router.post("/inventory/items", authorize(...ADMIN), branchAccess, validate(addItemSchema), addItem);
router.get("/inventory/items", authorize(...ADMIN), getItems);
router.get("/inventory/items/:id", authorize(...ADMIN), getItemById);
router.post("/inventory/purchase", authorize(...ADMIN), validate(purchaseStockSchema), purchaseStock);
router.post("/inventory/issue", authorize(...ADMIN), validate(issueStockSchema), issueStock);
router.get("/inventory/low-stock", authorize(...ADMIN), getLowStockAlerts);
router.delete("/inventory/items/:id", authorize(...ADMIN), deleteItem);

// === TRANSPORT ===
router.post("/transport/routes", authorize(...ADMIN, UserRole.TRANSPORT_MANAGER), branchAccess, validate(createRouteSchema), createRoute);
router.get("/transport/routes", getRoutes);
router.post("/transport/stops", authorize(...ADMIN, UserRole.TRANSPORT_MANAGER), validate(addStopSchema), addStop);
router.post("/transport/allocate", authorize(...ADMIN, UserRole.TRANSPORT_MANAGER), validate(allocateStudentSchema), allocateStudent);
router.delete("/transport/allocate/:studentId", authorize(...ADMIN, UserRole.TRANSPORT_MANAGER), removeAllocation);
router.get("/transport/vehicles", getVehicles);
router.get("/transport/vehicles/:id", getVehicleById);
router.post("/transport/vehicles", authorize(...ADMIN, UserRole.TRANSPORT_MANAGER), branchAccess, validate(addVehicleSchema), addVehicle);
router.delete("/transport/vehicles/:id", authorize(...ADMIN, UserRole.TRANSPORT_MANAGER), deleteVehicle);
router.delete("/transport/routes/:id", authorize(...ADMIN, UserRole.TRANSPORT_MANAGER), deleteRoute);
router.post("/transport/vehicle-routes", authorize(...ADMIN, UserRole.TRANSPORT_MANAGER), validate(assignVehicleToRouteSchema), assignVehicleToRoute);
router.delete("/transport/vehicle-routes/:vehicleId/:routeId", authorize(...ADMIN, UserRole.TRANSPORT_MANAGER), unassignVehicleFromRoute);

// === HOSTEL ===
router.post("/hostel/buildings", authorize(...ADMIN, UserRole.WARDEN), branchAccess, validate(createBuildingSchema), createBuilding);
router.get("/hostel/buildings", getBuildings);
router.post("/hostel/floors", authorize(...ADMIN, UserRole.WARDEN), validate(addFloorSchema), addFloor);
router.post("/hostel/rooms", authorize(...ADMIN, UserRole.WARDEN), validate(addRoomSchema), addRoom);
router.post("/hostel/allocate", authorize(...ADMIN, UserRole.WARDEN), validate(allocateRoomSchema), allocateRoom);
router.post("/hostel/allocate/bulk", authorize(...ADMIN, UserRole.WARDEN), validate(bulkAllocateRoomSchema), bulkAllocateRoom);
router.patch("/hostel/deallocate/:id", authorize(...ADMIN, UserRole.WARDEN), deallocateRoom);
router.get("/hostel/occupancy", getOccupancy);
router.delete("/hostel/buildings/:id", authorize(...ADMIN, UserRole.WARDEN), deleteBuilding);

// === SCHOOL BUILDINGS (general-purpose: classrooms/labs/offices/etc) ===
router.post("/school-buildings", authorize(...ADMIN), branchAccess, validate(createSchoolBuildingSchema), createSchoolBuilding);
router.get("/school-buildings", getSchoolBuildings);
router.get("/school-buildings/occupancy", authorize(...ADMIN), getSchoolOccupancySummary);
router.post("/school-buildings/floors", authorize(...ADMIN), validate(addSchoolFloorSchema), addSchoolFloor);
router.post("/school-buildings/rooms", authorize(...ADMIN), validate(addSchoolRoomSchema), addSchoolRoom);
router.put("/school-buildings/rooms/:id", authorize(...ADMIN), validate(updateSchoolRoomSchema), updateSchoolRoom);
router.delete("/school-buildings/rooms/:id", authorize(...ADMIN), deleteSchoolRoom);
router.delete("/school-buildings/:id", authorize(...ADMIN), deleteSchoolBuilding);
router.post("/school-buildings/floors/bulk", authorize(...ADMIN), validate(bulkAddSchoolFloorsSchema), bulkAddSchoolFloors);
router.post("/school-buildings/rooms/bulk", authorize(...ADMIN), validate(bulkAddSchoolRoomsSchema), bulkAddSchoolRooms);

// Multi-cabin chambers (RoomCabin) - opt-in, only for rooms that need
// several named seats tracked individually (see the model's doc
// comment in schema.prisma).
router.post("/school-buildings/cabins", authorize(...ADMIN), validate(addRoomCabinSchema), addRoomCabin);
router.get("/school-buildings/rooms/:roomId/cabins", authorize(...ADMIN), getRoomCabins);
router.put("/school-buildings/cabins/:id", authorize(...ADMIN), validate(updateRoomCabinSchema), updateRoomCabin);
router.delete("/school-buildings/cabins/:id", authorize(...ADMIN), deleteRoomCabin);

// === ATTENDANCE DEVICES (RFID/card-tap readers) - Phase 5 ===
router.post("/attendance-devices", authorize(...ADMIN), branchAccess, validate(createDeviceSchema), createDevice);
router.get("/attendance-devices", authorize(...ADMIN), getDevices);
router.patch("/attendance-devices/:id", authorize(...ADMIN), validate(updateDeviceSchema), updateDevice);
router.post("/attendance-devices/:id/regenerate-key", authorize(...ADMIN), regenerateApiKey);
router.delete("/attendance-devices/:id", authorize(...ADMIN), deleteDevice);

export default router;
