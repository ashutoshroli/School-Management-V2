import { Router } from "express";
import { UserRole } from "@prisma/client";
import { addBook, getBooks, getBookById, issueBook, bulkIssueBook, returnBook, getIssuedBooks, deleteBook, issueBookToStaff, markLostOrDamaged, waiveLibraryCost, getLibraryConfig, upsertLibraryConfig, getStaffIssuedBooks, returnStaffBook } from "../controllers/library.controller";
import { addItem, getItems, getItemById, purchaseStock, issueStock, getLowStockAlerts, deleteItem, returnIssuedStock, raiseInventoryPurchaseRequest, advanceInventoryPurchaseRequest, getInventoryPurchaseRequests, getApplianceExpiryAlerts } from "../controllers/inventory.controller";
import { createRoute, getRoutes, addStop, allocateStudent, removeAllocation, getVehicles, getVehicleById, addVehicle, updateVehicle, deleteVehicle, deleteRoute, assignVehicleToRoute, unassignVehicleFromRoute, updateVehicleLocation, getVehicleLocations, logVehicleMaintenance, getVehicleMaintenanceLogs, setRouteDistance, getEffectiveStopFee } from "../controllers/transport.controller";
import { createBuilding, getBuildings, addFloor, addRoom, allocateRoom, bulkAllocateRoom, deallocateRoom, getOccupancy, deleteBuilding, bulkAddFloors, bulkAddRooms, requestBed, respondToRoomRequest, getSuggestedRooms, setAllotmentCutoff, finalizeHostelAllotments, hostelTap, getCurrentlyInHostel, getRoomRequests, getMyHostelStatus } from "../controllers/hostel.controller";
import { createSchoolBuilding, getSchoolBuildings, addSchoolFloor, addSchoolRoom, updateSchoolRoom, deleteSchoolRoom, deleteSchoolBuilding, getSchoolOccupancySummary, bulkAddSchoolFloors, bulkAddSchoolRooms, addRoomCabin, getRoomCabins, updateRoomCabin, deleteRoomCabin } from "../controllers/schoolBuilding.controller";
import { createDevice, getDevices, updateDevice, regenerateApiKey, deleteDevice } from "../controllers/attendanceDevice.controller";
import { authenticate, authorize, branchAccess } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { addBookSchema, issueBookSchema, bulkIssueBookSchema, issueBookToStaffSchema, markLostOrDamagedSchema, waiveLibraryCostSchema, upsertLibraryConfigSchema } from "../validators/library.validator";
import { addItemSchema, purchaseStockSchema, issueStockSchema, returnIssuedStockSchema, raiseInventoryPurchaseRequestSchema, advanceInventoryPurchaseRequestSchema } from "../validators/inventory.validator";
import { createRouteSchema, addStopSchema, allocateStudentSchema, addVehicleSchema, updateVehicleSchema, assignVehicleToRouteSchema, updateVehicleLocationSchema, logVehicleMaintenanceSchema, setRouteDistanceSchema } from "../validators/transport.validator";
import { createBuildingSchema, addFloorSchema, addRoomSchema, allocateRoomSchema, bulkAllocateRoomSchema, bulkAddFloorsSchema, bulkAddRoomsSchema, requestBedSchema, respondToRoomRequestSchema, setAllotmentCutoffSchema, finalizeHostelAllotmentsSchema, hostelTapSchema } from "../validators/hostel.validator";
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
router.post("/library/issue/staff", authorize(...ADMIN, UserRole.LIBRARIAN), validate(issueBookToStaffSchema), issueBookToStaff);
router.get("/library/issued/staff", authorize(...ADMIN, UserRole.LIBRARIAN), getStaffIssuedBooks);
router.patch("/library/return/staff/:id", authorize(...ADMIN, UserRole.LIBRARIAN), returnStaffBook);
router.patch("/library/issue/:id/lost-damaged", authorize(...ADMIN, UserRole.LIBRARIAN), validate(markLostOrDamagedSchema), markLostOrDamaged);
// Waiver restricted to Principal/Admin per spec Section 12.
router.patch("/library/issue/:id/waive", authorize(...ADMIN, UserRole.PRINCIPAL, UserRole.VICE_PRINCIPAL), validate(waiveLibraryCostSchema), waiveLibraryCost);
router.get("/library/config", authorize(...ADMIN, UserRole.LIBRARIAN), getLibraryConfig);
router.put("/library/config", authorize(...ADMIN), validate(upsertLibraryConfigSchema), upsertLibraryConfig);

// === INVENTORY ===
router.post("/inventory/items", authorize(...ADMIN), branchAccess, validate(addItemSchema), addItem);
router.get("/inventory/items", authorize(...ADMIN), getItems);
router.get("/inventory/items/:id", authorize(...ADMIN), getItemById);
router.post("/inventory/purchase", authorize(...ADMIN), validate(purchaseStockSchema), purchaseStock);
router.post("/inventory/issue", authorize(...ADMIN), validate(issueStockSchema), issueStock);
router.get("/inventory/low-stock", authorize(...ADMIN), getLowStockAlerts);
router.delete("/inventory/items/:id", authorize(...ADMIN), deleteItem);
router.patch("/inventory/issue/:id/return", authorize(...ADMIN), validate(returnIssuedStockSchema), returnIssuedStock);
// Purchase/reorder approval chain (spec Section 17)
router.post("/inventory/purchase-requests", authorize(...ADMIN), validate(raiseInventoryPurchaseRequestSchema), raiseInventoryPurchaseRequest);
router.get("/inventory/purchase-requests", authorize(...ADMIN), getInventoryPurchaseRequests);
router.patch("/inventory/purchase-requests/:id/advance", authorize(...ADMIN), validate(advanceInventoryPurchaseRequestSchema), advanceInventoryPurchaseRequest);
router.get("/inventory/appliance-alerts", authorize(...ADMIN), getApplianceExpiryAlerts);

// === TRANSPORT ===
router.post("/transport/routes", authorize(...ADMIN, UserRole.TRANSPORT_MANAGER), branchAccess, validate(createRouteSchema), createRoute);
router.get("/transport/routes", getRoutes);
router.post("/transport/stops", authorize(...ADMIN, UserRole.TRANSPORT_MANAGER), validate(addStopSchema), addStop);
router.post("/transport/allocate", authorize(...ADMIN, UserRole.TRANSPORT_MANAGER), validate(allocateStudentSchema), allocateStudent);
router.delete("/transport/allocate/:studentId", authorize(...ADMIN, UserRole.TRANSPORT_MANAGER), removeAllocation);
router.get("/transport/vehicles", getVehicles);
router.get("/transport/vehicles/:id", getVehicleById);
router.post("/transport/vehicles", authorize(...ADMIN, UserRole.TRANSPORT_MANAGER), branchAccess, validate(addVehicleSchema), addVehicle);
router.patch("/transport/vehicles/:id", authorize(...ADMIN, UserRole.TRANSPORT_MANAGER), validate(updateVehicleSchema), updateVehicle);
router.delete("/transport/vehicles/:id", authorize(...ADMIN, UserRole.TRANSPORT_MANAGER), deleteVehicle);
router.delete("/transport/routes/:id", authorize(...ADMIN, UserRole.TRANSPORT_MANAGER), deleteRoute);
router.post("/transport/vehicle-routes", authorize(...ADMIN, UserRole.TRANSPORT_MANAGER), validate(assignVehicleToRouteSchema), assignVehicleToRoute);
router.delete("/transport/vehicle-routes/:vehicleId/:routeId", authorize(...ADMIN, UserRole.TRANSPORT_MANAGER), unassignVehicleFromRoute);
// GPS live location (spec Section 11)
router.patch("/transport/vehicles/:id/location", validate(updateVehicleLocationSchema), updateVehicleLocation);
router.get("/transport/vehicles/locations", authorize(...ADMIN, UserRole.TRANSPORT_MANAGER), getVehicleLocations);
// Fuel/maintenance tracking for both Own and Rented vehicles (spec Section 11)
router.post("/transport/vehicles/maintenance", authorize(...ADMIN, UserRole.TRANSPORT_MANAGER), validate(logVehicleMaintenanceSchema), logVehicleMaintenance);
router.get("/transport/vehicles/:vehicleId/maintenance", authorize(...ADMIN, UserRole.TRANSPORT_MANAGER), getVehicleMaintenanceLogs);
// Route distance measurement + diesel-distance override (spec Section 11)
router.patch("/transport/routes/:id/distance", authorize(...ADMIN, UserRole.TRANSPORT_MANAGER), validate(setRouteDistanceSchema), setRouteDistance);
router.get("/transport/stops/:stopId/effective-fee", authorize(...ADMIN, UserRole.TRANSPORT_MANAGER, UserRole.ACCOUNTANT), getEffectiveStopFee);

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
router.post("/hostel/floors/bulk", authorize(...ADMIN, UserRole.WARDEN), validate(bulkAddFloorsSchema), bulkAddFloors);
router.post("/hostel/rooms/bulk", authorize(...ADMIN, UserRole.WARDEN), validate(bulkAddRoomsSchema), bulkAddRooms);
// Roommate-approval bed allotment flow (spec Section 13)
router.post("/hostel/request-bed", authorize(...ADMIN, UserRole.WARDEN, UserRole.STUDENT, UserRole.PARENT), validate(requestBedSchema), requestBed);
router.patch("/hostel/room-requests/:id/respond", authorize(...ADMIN, UserRole.WARDEN, UserRole.STUDENT, UserRole.PARENT), validate(respondToRoomRequestSchema), respondToRoomRequest);
router.get("/hostel/suggested-rooms", authorize(...ADMIN, UserRole.WARDEN, UserRole.STUDENT, UserRole.PARENT), getSuggestedRooms);
router.get("/hostel/room-requests", authorize(...ADMIN, UserRole.WARDEN, UserRole.STUDENT, UserRole.PARENT), getRoomRequests);
router.get("/hostel/my-status", authorize(UserRole.STUDENT, UserRole.PARENT), getMyHostelStatus);
router.patch("/hostel/rooms/:id/allotment-cutoff", authorize(...ADMIN, UserRole.WARDEN), validate(setAllotmentCutoffSchema), setAllotmentCutoff);
router.post("/hostel/finalize-allotments", authorize(...ADMIN, UserRole.WARDEN), validate(finalizeHostelAllotmentsSchema), finalizeHostelAllotments);
// RFID in/out (spec Section 13)
router.post("/hostel/tap", validate(hostelTapSchema), hostelTap);
router.get("/hostel/currently-in", authorize(...ADMIN, UserRole.WARDEN), getCurrentlyInHostel);

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
