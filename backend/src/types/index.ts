import { UserRole } from "@prisma/client";
import { Request } from "express";

export interface JwtPayload {
  userId: string;
  email: string;
  role: UserRole;
  organizationId?: string;
  branchId?: string;
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
