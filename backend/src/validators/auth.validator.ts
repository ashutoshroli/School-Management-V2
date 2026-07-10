import { z } from "zod";

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email("Valid email required"),
    password: z.string().min(6, "Password must be at least 6 characters"),
  }),
});

export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1, "Current password required"),
    newPassword: z
      .string()
      .min(8, "New password must be at least 8 characters")
      .regex(/[A-Z]/, "Must contain uppercase letter")
      .regex(/[0-9]/, "Must contain a number"),
  }),
});
