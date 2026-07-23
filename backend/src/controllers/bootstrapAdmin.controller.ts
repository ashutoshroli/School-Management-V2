/**
 * TEMPORARY - DELETE THIS FILE (and its route in
 * routes/bootstrapAdmin.routes.ts, the `router.use("/internal", ...)`
 * line in routes/index.ts, and bootstrapAdminSchema in
 * validators/bootstrapAdmin.validator.ts) ONCE YOU'VE SUCCESSFULLY
 * BOOTSTRAPPED YOUR FIRST SUPER ADMIN AND LOGGED IN WITH IT.
 *
 * One-time-use route for creating the very first Super Admin on a
 * deployment where `db/prisma/seed.ts` can't be run from your own
 * machine - e.g. Render's free-tier managed Postgres only exposes an
 * INTERNAL connection string (only reachable from other services
 * inside the same Render private network), so `DATABASE_URL` from a
 * local machine can't reach it at all. This runs the equivalent of
 * seed.ts's Super Admin creation step from INSIDE the already-running
 * backend service instead, which already has that internal DB access
 * via its own DATABASE_URL.
 *
 * Safety, so this is safe to leave deployed for the short time it
 * takes you to use it:
 *   - Refuses with 409 if a Super Admin already exists - can't be used
 *     to create a second one, and re-running it after success is a
 *     safe no-op-that-errors rather than a duplicate admin.
 *   - Requires an exact `X-Bootstrap-Secret` header match against the
 *     BOOTSTRAP_SECRET env var - 401 if missing/wrong. If
 *     BOOTSTRAP_SECRET itself was never set on the server, this fails
 *     CLOSED with 503 (see the `!config.bootstrapSecret` check below)
 *     rather than silently accepting an empty header as a match.
 *   - Never logs or returns the password/hash - only id/email/name/role
 *     of the created user.
 *
 * Even with both checks, an endpoint that can create an admin account
 * should not be left in the codebase long-term - remove it in a
 * follow-up PR once you've confirmed you can log in with the account
 * it created via POST /api/auth/login.
 */
import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { UserRole } from "@prisma/client";
import prisma from "../config/database";
import { config } from "../config";
import { sendSuccess, sendError } from "../utils/response";

export const bootstrapAdmin = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!config.bootstrapSecret) {
      sendError(
        res,
        "Bootstrap is not configured on this server (missing BOOTSTRAP_SECRET env var)",
        503
      );
      return;
    }

    const providedSecret = req.header("X-Bootstrap-Secret");
    if (!providedSecret || providedSecret !== config.bootstrapSecret) {
      sendError(res, "Invalid or missing X-Bootstrap-Secret header", 401);
      return;
    }

    const existingSuperAdmin = await prisma.user.findFirst({
      where: { role: UserRole.SUPER_ADMIN },
      select: { id: true },
    });
    if (existingSuperAdmin) {
      sendError(res, "A Super Admin already exists - bootstrap can only be used once", 409);
      return;
    }

    const { email, password, name } = req.body;

    // Same hashing as every other password path in this codebase (see
    // auth.controller.ts's changePassword and db/prisma/seed.ts) - 12
    // bcrypt rounds.
    const hashedPassword = await bcrypt.hash(password, 12);

    const superAdmin = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name: name || "Super Administrator",
        role: UserRole.SUPER_ADMIN,
        isActive: true,
      },
    });

    sendSuccess(
      res,
      {
        id: superAdmin.id,
        email: superAdmin.email,
        name: superAdmin.name,
        role: superAdmin.role,
      },
      "Super Admin created. Log in via POST /api/auth/login, then let your assistant know so this bootstrap endpoint can be removed in a follow-up PR.",
      201
    );
  } catch (error: any) {
    // Prisma unique constraint violation - email already belongs to some
    // (non-Super-Admin) existing user.
    if (error?.code === "P2002") {
      sendError(res, "A user with this email already exists", 409);
      return;
    }
    sendError(res, "Failed to bootstrap Super Admin", 500, (error as Error).message);
  }
};
