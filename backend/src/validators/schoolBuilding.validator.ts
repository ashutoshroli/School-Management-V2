import { z } from "zod";

const ROOM_TYPES = [
  "CLASSROOM",
  "LAB",
  "OFFICE",
  "CHAMBER",
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
  }),
});
