import { z } from "zod";

const money = z.union([z.number(), z.string()]).transform((v) => Number(v)).refine((v) => Number.isFinite(v) && v >= 0, {
  message: "Must be a non-negative number",
});

export const createRouteSchema = z.object({
  body: z.object({
    branchId: z.string().optional(),
    name: z.string().min(1, "name is required"),
    startPoint: z.string().min(1, "startPoint is required"),
    endPoint: z.string().min(1, "endPoint is required"),
    distance: money.optional(),
    monthlyFee: money,
  }),
});

export const addStopSchema = z.object({
  body: z.object({
    routeId: z.string().min(1, "routeId is required"),
    name: z.string().min(1, "name is required"),
    order: z.number().int().min(0, "order is required"),
    time: z.string().min(1, "time is required"),
    distanceFromStartKm: money.optional(),
    monthlyFeeOverride: money.optional(),
  }),
});

export const allocateStudentSchema = z.object({
  body: z.object({
    studentId: z.string().min(1, "studentId is required"),
    routeId: z.string().min(1, "routeId is required"),
    stopName: z.string().optional(),
  }),
});

export const addVehicleSchema = z.object({
  body: z.object({
    branchId: z.string().optional(),
    vehicleNo: z.string().min(1, "vehicleNo is required"),
    type: z.string().min(1, "type is required"),
    capacity: z.number().int().min(1, "capacity must be a positive integer"),
    driverName: z.string().optional(),
    driverPhone: z.string().optional(),
    driverLicense: z.string().optional(),
    ownership: z.enum(["OWN", "RENTED"]).optional(),
    monthlyFixedFee: money.optional(),
    perKmRate: money.optional(),
  }),
});

export const assignVehicleToRouteSchema = z.object({
  body: z.object({
    vehicleId: z.string().min(1, "vehicleId is required"),
    routeId: z.string().min(1, "routeId is required"),
  }),
});


export const updateVehicleLocationSchema = z.object({
  body: z.object({
    lat: z.number(),
    lng: z.number(),
  }),
});

export const logVehicleMaintenanceSchema = z.object({
  body: z.object({
    vehicleId: z.string().min(1, "vehicleId is required"),
    type: z.string().min(1, "type is required"),
    cost: money,
    odometerReading: z.number().int().optional(),
    notes: z.string().optional(),
  }),
});

export const setRouteDistanceSchema = z.object({
  body: z.object({
    distance: money.optional(),
    dieselDistanceOverride: money.optional(),
  }),
});
