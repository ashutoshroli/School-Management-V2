import { z } from "zod";

// BUG FIX: TEACHER_CHAMBER was missing from this list even though it
// has existed in the SchoolRoomType enum (schema.prisma) and in the
// frontend's own ROOM_TYPES dropdown (buildings/page.tsx) all along -
// z.enum() rejects any value not explicitly listed here, so saving a
// room with type "TEACHER_CHAMBER" always 400'd at validation before
// the request ever reached the controller.
const ROOM_TYPES = [
  "CLASSROOM",
  "LAB",
  "OFFICE",
  "CHAMBER",
  "TEACHER_CHAMBER",
  "STAFF_ROOM",
  "LIBRARY",
  "AUDITORIUM",
  "SPORTS_ROOM",
  "TOILET",
  "STORE",
  "CANTEEN",
  "MEDICAL_ROOM",
  "OTHER",
] as const;

// Room operational status (spec Section 18B) - see RoomStatus enum's
// doc comment in schema.prisma.
const ROOM_STATUSES = ["ACTIVE", "MAINTENANCE", "VACANT"] as const;

export const createSchoolBuildingSchema = z.object({
  body: z.object({
    branchId: z.string().optional(),
    name: z.string().min(1, "name is required"),
    description: z.string().optional(),
  }),
});

export const addSchoolFloorSchema = z.object({
  body: z.object({
    buildingId: z.string().min(1, "buildingId is required"),
    floorNo: z.number().int().min(0, "floorNo is required"),
    name: z.string().optional(),
  }),
});

export const addSchoolRoomSchema = z.object({
  body: z.object({
    floorId: z.string().min(1, "floorId is required"),
    roomNo: z.string().min(1, "roomNo is required"),
    name: z.string().optional(),
    type: z.enum(ROOM_TYPES),
    capacity: z.number().int().min(0).optional(),
    directionFromGate: z.string().optional(),
    assignedStaffId: z.string().optional(),
    department: z.string().optional(),
    status: z.enum(ROOM_STATUSES).optional(),
  }),
});

export const updateSchoolRoomSchema = z.object({
  body: z.object({
    roomNo: z.string().min(1).optional(),
    name: z.string().optional(),
    type: z.enum(ROOM_TYPES).optional(),
    capacity: z.number().int().min(0).optional(),
    directionFromGate: z.string().optional(),
    assignedStaffId: z.string().nullable().optional(),
    department: z.string().nullable().optional(),
    status: z.enum(ROOM_STATUSES).optional(),
  }),
});

export const bulkAddSchoolFloorsSchema = z.object({
  body: z.object({
    buildingId: z.string().min(1, "buildingId is required"),
    count: z.number().int().min(1, "count must be at least 1").max(50, "count cannot exceed 50 at once"),
    startingFloorNo: z.number().int().optional(),
    namePrefix: z.string().optional(),
  }),
});

const bulkRoomEntrySchema = z.object({
  roomNo: z.string().min(1, "roomNo is required"),
  name: z.string().optional(),
  type: z.enum(ROOM_TYPES),
  capacity: z.number().int().min(0).optional(),
  directionFromGate: z.string().optional(),
  assignedStaffId: z.string().optional(),
  department: z.string().optional(),
  status: z.enum(ROOM_STATUSES).optional(),
});

export const bulkAddSchoolRoomsSchema = z.object({
  body: z.object({
    floorId: z.string().min(1, "floorId is required"),
    rooms: z.array(bulkRoomEntrySchema).min(1, "rooms must be a non-empty array"),
  }),
});

export const addRoomCabinSchema = z.object({
  body: z.object({
    roomId: z.string().min(1, "roomId is required"),
    cabinNo: z.string().min(1, "cabinNo is required"),
    staffId: z.string().optional(),
  }),
});

export const updateRoomCabinSchema = z.object({
  body: z.object({
    cabinNo: z.string().min(1).optional(),
    staffId: z.string().nullable().optional(),
  }),
});
