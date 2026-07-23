import { z } from "zod";

// TEMPORARY - see controllers/bootstrapAdmin.controller.ts's header
// comment. Delete this file once the one-time bootstrap endpoint is
// removed.
export const bootstrapAdminSchema = z.object({
  body: z.object({
    email: z.string().email("Valid email required"),
    // Same strength rules as changePasswordSchema/resetPasswordSchema
    // in auth.validator.ts, since this is creating a real Super Admin
    // account.
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[A-Z]/, "Must contain at least one uppercase letter")
      .regex(/[a-z]/, "Must contain at least one lowercase letter")
      .regex(/[0-9]/, "Must contain at least one number"),
    name: z.string().min(1).optional(),
  }),
});
