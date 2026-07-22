import { z } from "zod";

const money = z.union([z.number(), z.string()]).transform((v) => Number(v)).refine((v) => Number.isFinite(v) && v >= 0, {
  message: "Must be a non-negative number",
});

export const addLabEquipmentSchema = z.object({
  body: z.object({
    branchId: z.string().optional(),
    name: z.string().min(1, "name is required"),
    category: z.string().optional(),
    totalQuantity: z.number().int().min(1).optional(),
    isConsumable: z.boolean().optional(),
    expiryDate: z.coerce.date().optional(),
  }),
});

export const issueLabEquipmentSchema = z.object({
  body: z.object({
    equipmentId: z.string().min(1, "equipmentId is required"),
    quantity: z.number().int().min(1),
    groupLabel: z.string().optional(),
    studentId: z.string().optional(),
    staffId: z.string().optional(),
  }),
});

export const returnLabEquipmentSchema = z.object({
  body: z.object({
    status: z.enum(["RETURNED", "DAMAGED", "LOST"]),
    damageFine: money.optional(),
  }),
});

export const waiveLabDamageFineSchema = z.object({
  body: z.object({
    waivedAmount: money,
  }),
});
