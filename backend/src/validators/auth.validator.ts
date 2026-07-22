import { z } from "zod";

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email("Valid email required"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    // "Remember Me" option (spec Section 3) - optional, defaults to
    // false (the original session-length behavior) when omitted.
    rememberMe: z.boolean().optional(),
  }),
});

export const switchBranchSchema = z.object({
  body: z.object({
    branchId: z.string().min(1, "branchId is required"),
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


export const forgotPasswordSchema = z.object({
  body: z.object({
    email: z.string().email("Valid email required"),
  }),
});

export const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(1, "Reset token is required"),
    newPassword: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[A-Z]/, "Must contain at least one uppercase letter")
      .regex(/[a-z]/, "Must contain at least one lowercase letter")
      .regex(/[0-9]/, "Must contain at least one number"),
  }),
});
