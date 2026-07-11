import { z } from "zod";

export const createBuildingSchema = z.object({
  body: z.object({
    branchId: z.string().optional(),
    name: z.string().min(1, "name is required"),
    type: z.enum(["BOYS", "GIRLS"]),
    warden: z.string().optional(),
  }),
});

export const addFloorSchema = z.object({
  body: z.object({
    buildingId: z.string().min(1, "buildingId is required"),
    floorNo: z.number().int().min(0, "floorNo is required"),
  }),
});

export const addRoomSchema = z.object({
  body: z.object({
    floorId: z.string().min(1, "floorId is required"),
    roomNo: z.string().min(1, "roomNo is required"),
    type: z.enum(["SINGLE", "DOUBLE", "DORMITORY"]),
    capacity: z.number().int().min(1, "capacity must be a positive integer"),
    monthlyFee: z.union([z.number(), z.string()]).transform((v) => Number(v)).refine((v) => Number.isFinite(v) && v >= 0, {
      message: "monthlyFee must be a non-negative number",
    }),
  }),
});

export const allocateRoomSchema = z.object({
  body: z.object({
    studentId: z.string().min(1, "studentId is required"),
    roomId: z.string().min(1, "roomId is required"),
    bedNo: z.string().optional(),
  }),
});

export const bulkAllocateRoomSchema = z.object({
  body: z.object({
    buildingId: z.string().min(1, "buildingId is required"),
    // Optional - narrows the fill-scope to a single floor within the building.
    floorId: z.string().optional(),
    studentIds: z.array(z.string().min(1)).min(1, "studentIds must be a non-empty array"),
    reassignExisting: z.boolean().optional(),
  }),
});
