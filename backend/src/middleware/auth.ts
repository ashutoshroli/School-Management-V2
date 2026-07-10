import { Response, NextFunction } from "express";
import { UserRole } from "@prisma/client";
import { AuthRequest, JwtPayload } from "../types";
import { verifyToken } from "../utils/jwt";
import { sendError } from "../utils/response";

/**
 * Authentication middleware - verifies JWT token
 */
export const authenticate = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : req.cookies?.token;

    if (!token) {
      sendError(res, "Authentication required", 401);
      return;
    }

    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    sendError(res, "Invalid or expired token", 401);
  }
};

/**
 * Role-based authorization middleware
 * Usage: authorize(UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN)
 */
export const authorize = (...allowedRoles: UserRole[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      sendError(res, "Authentication required", 401);
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      sendError(res, "Insufficient permissions", 403);
      return;
    }

    next();
  };
};

/**
 * Branch access middleware - ensures user can only access their own branch data
 * Super Admin bypasses this check
 */
export const branchAccess = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    sendError(res, "Authentication required", 401);
    return;
  }

  // Super Admin can access all branches
  if (req.user.role === UserRole.SUPER_ADMIN) {
    next();
    return;
  }

  // Check if requested branchId matches user's branch
  const requestedBranch = req.params.branchId || req.body?.branchId;
  if (requestedBranch && requestedBranch !== req.user.branchId) {
    sendError(res, "Access denied: branch mismatch", 403);
    return;
  }

  next();
};
