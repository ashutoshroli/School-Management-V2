import { z } from "zod";

export const createDeviceSchema = z.object({
  body: z.object({
    name: z.string().min(1, "name is required"),
    location: z.string().optional(),
  }),
});

export const updateDeviceSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    location: z.string().optional(),
    isActive: z.boolean().optional(),
  }),
});
