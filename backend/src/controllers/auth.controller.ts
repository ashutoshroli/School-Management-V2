import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { UserRole } from "@prisma/client";
import prisma from "../config/database";
import { config } from "../config";
import { generateToken } from "../utils/jwt";
import { sendSuccess, sendError } from "../utils/response";
import { AuthRequest, JwtPayload } from "../types";

/**
 * Login with email + password (Admin/Teacher/Accountant/Staff)
 */
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        staff: { select: { branchId: true } },
      },
    });

    if (!user || !user.password) {
      sendError(res, "Invalid email or password", 401);
      return;
    }

    if (!user.isActive) {
      sendError(res, "Account is deactivated", 403);
      return;
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      sendError(res, "Invalid email or password", 401);
      return;
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    // SUPER_ADMIN has no linked Staff record (they're not staff at any
    // one branch, by design), so they have no branchId of their own.
    // Every branch-scoped list/report endpoint (Academic Years,
    // Classes, Accounting Reports, Dashboard, etc.) requires a
    // resolvable branchId though - without this, those pages fail with
    // "Branch ID required" for a Super Admin on a deployment where
    // there's no UI to pick a branch. Default to the school's first
    // active branch so those pages work out of the box; a Super Admin
    // can still target a different branch explicitly via `?branchId=`
    // on any endpoint (see utils/branchScope.ts's resolveBranchId).
    //
    // Scoped to SUPER_ADMIN only - other roles (Branch Admin,
    // Accountant, Teacher, ...) are expected to have a real Staff
    // record with its own branchId; silently defaulting a branch for
    // them if that's ever missing would be a data problem worth
    // surfacing, not papering over with implicit branch access.
    let branchId = user.staff?.branchId || undefined;
    if (!branchId && user.role === UserRole.SUPER_ADMIN) {
      const defaultBranch = await prisma.branch.findFirst({
        where: { isActive: true },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      branchId = defaultBranch?.id;
    }

    const payload: JwtPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId || undefined,
      branchId,
    };

    const token = generateToken(payload);

    sendSuccess(res, {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
      },
    }, "Login successful");
  } catch (error) {
    sendError(res, "Login failed", 500, (error as Error).message);
  }
};

/**
 * Google OAuth callback handler
 */
export const googleCallback = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user as any;
    if (!user) {
      sendError(res, "Google authentication failed", 401);
      return;
    }

    // Determine branchId based on role
    let branchId: string | undefined;
    if (user.role === UserRole.STUDENT) {
      const student = await prisma.student.findUnique({ where: { userId: user.id } });
      branchId = student?.branchId;
    } else if (user.role === UserRole.PARENT) {
      // Parent gets branch from first child
      const parentLink = await prisma.studentParent.findFirst({
        where: { parent: { userId: user.id } },
        include: { student: { select: { branchId: true } } },
      });
      branchId = parentLink?.student.branchId;
    } else {
      const staff = await prisma.staff.findUnique({ where: { userId: user.id } });
      branchId = staff?.branchId;
    }

    // Same reasoning as the email/password login() above: a SUPER_ADMIN
    // has no Staff record, so default them to the school's first active
    // branch rather than leaving branch-scoped pages broken.
    if (!branchId && user.role === UserRole.SUPER_ADMIN) {
      const defaultBranch = await prisma.branch.findFirst({
        where: { isActive: true },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      branchId = defaultBranch?.id;
    }

    const payload: JwtPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId || undefined,
      branchId,
    };

    const token = generateToken(payload);

    // Redirect to frontend with token
    res.redirect(`${config.frontendUrl}/auth/callback?token=${token}`);
  } catch (error) {
    sendError(res, "Google auth failed", 500, (error as Error).message);
  }
};

/**
 * Get current user profile
 */
export const getProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      sendError(res, "Not authenticated", 401);
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        avatar: true,
        organizationId: true,
        lastLogin: true,
        createdAt: true,
      },
    });

    if (!user) {
      sendError(res, "User not found", 404);
      return;
    }

    sendSuccess(res, user, "Profile fetched");
  } catch (error) {
    sendError(res, "Failed to fetch profile", 500);
  }
};

/**
 * Change password
 */
export const changePassword = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      sendError(res, "Not authenticated", 401);
      return;
    }

    const { currentPassword, newPassword } = req.body;

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
    });

    if (!user || !user.password) {
      sendError(res, "Cannot change password for OAuth-only accounts", 400);
      return;
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      sendError(res, "Current password is incorrect", 400);
      return;
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    sendSuccess(res, null, "Password changed successfully");
  } catch (error) {
    sendError(res, "Failed to change password", 500);
  }
};
