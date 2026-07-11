import { z } from "zod";

export const createBranchSchema = z.object({
  body: z.object({
    name: z.string().min(1, "Branch name is required"),
    code: z.string().min(1, "Branch code is required"),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    pincode: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email("Invalid email").optional().or(z.literal("")),
  }),
});

export const updateBranchSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    pincode: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email("Invalid email").optional().or(z.literal("")),
    isActive: z.boolean().optional(),
    logo: z.string().optional(),
  }),
});

export const createBranchAdminSchema = z.object({
  body: z.object({
    branchId: z.string().min(1, "branchId is required"),
    name: z.string().min(1, "Name is required"),
    email: z.string().email("Valid email required"),
    phone: z.string().optional(),
    password: z.string().min(6, "Password must be at least 6 characters").optional(),
  }),
});

export const setBranchAdminStatusSchema = z.object({
  body: z.object({
    isActive: z.boolean(),
  }),
});
