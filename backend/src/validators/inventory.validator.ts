import { z } from "zod";

export const addItemSchema = z.object({
  body: z.object({
    branchId: z.string().optional(),
    name: z.string().min(1, "name is required"),
    category: z.string().min(1, "category is required"),
    unit: z.string().min(1, "unit is required"),
    minStock: z.number().int().min(0).optional(),
  }),
});

export const purchaseStockSchema = z.object({
  body: z.object({
    itemId: z.string().min(1, "itemId is required"),
    vendor: z.string().optional(),
    quantity: z.union([z.number(), z.string()]).transform((v) => Number(v)).refine((v) => Number.isFinite(v) && v > 0, {
      message: "quantity must be a positive number",
    }),
    rate: z.union([z.number(), z.string()]).transform((v) => Number(v)).refine((v) => Number.isFinite(v) && v >= 0, {
      message: "rate must be a non-negative number",
    }),
    billNo: z.string().optional(),
    billDate: z.coerce.date().optional(),
  }),
});

export const issueStockSchema = z.object({
  body: z.object({
    itemId: z.string().min(1, "itemId is required"),
    issuedTo: z.string().min(1, "issuedTo is required"),
    quantity: z.number().int().min(1, "quantity must be a positive integer"),
    purpose: z.string().optional(),
  }),
});
