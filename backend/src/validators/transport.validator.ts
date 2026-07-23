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

// Accepts either a full ISO datetime or a plain "YYYY-MM-DD" (what an
// <input type="date"> sends) for the 3 compliance-date fields below.
const dateInput = z
  .string()
  .refine((v) => !Number.isNaN(new Date(v).getTime()), { message: "Must be a valid date" })
  .transform((v) => new Date(v));

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
    // Compliance dates (spec Section 11) - these columns existed on
    // the Vehicle model since it was first added, but neither this
    // schema nor addVehicle's destructuring ever accepted them, so
    // they could only ever be set via a raw DB write. Optional/
    // backward compatible - a vehicle with none of these set behaves
    // exactly as before.
    insuranceExpiry: dateInput.optional(),
    fitnessExpiry: dateInput.optional(),
    pucExpiry: dateInput.optional(),
  }),
});

// Same shape as addVehicleSchema, but every field optional (a partial
// update) and with vehicleNo excluded - it's the unique lookup key
// elsewhere in this codebase's URLs/relations and isn't meant to be
// changed after creation via this endpoint.
export const updateVehicleSchema = z.object({
  body: z.object({
    type: z.string().min(1).optional(),
    capacity: z.number().int().min(1).optional(),
    driverName: z.string().optional(),
    driverPhone: z.string().optional(),
    driverLicense: z.string().optional(),
    ownership: z.enum(["OWN", "RENTED"]).optional(),
    monthlyFixedFee: money.optional(),
    perKmRate: money.optional(),
    insuranceExpiry: dateInput.optional(),
    fitnessExpiry: dateInput.optional(),
    pucExpiry: dateInput.optional(),
    isActive: z.boolean().optional(),
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
