import { z } from "zod";

const money = z.union([z.number(), z.string()]).transform((v) => Number(v)).refine((v) => Number.isFinite(v) && v >= 0, {
  message: "Must be a non-negative number",
});

export const addCanteenItemSchema = z.object({
  body: z.object({
    branchId: z.string().optional(),
    name: z.string().min(1, "name is required"),
    category: z.string().optional(),
    unit: z.string().min(1, "unit is required"),
    price: money,
    minStock: z.number().int().min(0).optional(),
    rackNo: z.string().optional(),
    counterNo: z.string().optional(),
  }),
});

export const rechargeWalletSchema = z.object({
  body: z.object({
    studentId: z.string().min(1, "studentId is required"),
    amount: money.refine((v) => v > 0, { message: "amount must be positive" }),
    rechargeMode: z.enum(["ONLINE", "CASH_AT_COUNTER"]),
  }),
});

export const createCanteenSaleSchema = z.object({
  body: z.object({
    branchId: z.string().optional(),
    studentId: z.string().optional(),
    items: z.array(z.object({
      itemId: z.string().min(1),
      quantity: z.number().int().min(1),
    })).min(1, "items must be a non-empty array"),
    paymentMode: z.enum(["WALLET", "CASH"]),
  }),
});

export const raiseCanteenStockRequestSchema = z.object({
  body: z.object({
    itemId: z.string().min(1, "itemId is required"),
    vendor: z.string().min(1, "vendor is required"),
    quantity: z.number().int().min(1),
    estimatedCost: money,
  }),
});

export const advanceCanteenStockRequestSchema = z.object({
  body: z.object({
    decision: z.enum(["APPROVE", "REJECT"]),
    rejectionReason: z.string().optional(),
  }),
});
