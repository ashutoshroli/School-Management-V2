import { UserRole } from "@prisma/client";
import { Request } from "express";

export interface JwtPayload {
  userId: string;
  email: string;
  role: UserRole;
  organizationId?: string;
  branchId?: string;
  // Super Admin "global bypass flag" (spec Section 3) - baked into the
  // JWT at login time from User.bypassAllChecks so canAccessBranch/
  // authorize-style checks can read it without a DB round trip on
  // every request. Only ever meaningful for a SUPER_ADMIN role token;
  // every other role's checks are unaffected by this value.
  bypassAllChecks?: boolean;
}

declare global {
  namespace Express {
    // @types/passport declares `Express.User` as an empty interface meant
    // to be extended via declaration merging (this is its documented
    // extension point). Without this, `Request.user` is typed as the
    // empty `Express.User`, which is structurally incompatible with our
    // `AuthRequest.user: JwtPayload` override - causing every route file
    // that passes an `(req: AuthRequest, ...) => ...` handler to
    // `router.get/post/put/delete/patch(...)` to fail to type-check
    // (pre-existing issue, not introduced by this change; fixed here at
    // the root so it doesn't keep recurring in every new route file).
    interface User extends JwtPayload {}

    interface Request {
      /** Raw request body bytes, captured by the json() verify hook in
       *  app.ts - needed to verify the Razorpay webhook HMAC signature. */
      rawBody?: Buffer;
    }
  }
}

export interface AuthRequest extends Request {
  user?: JwtPayload;
}

export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
