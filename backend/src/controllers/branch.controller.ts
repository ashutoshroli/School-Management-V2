import { Response } from "express";
import { UserRole } from "@prisma/client";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError, sendPaginated } from "../utils/response";

/**
 * Create a new branch
 */
export const createBranch = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, code, address, city, state, pincode, phone, email } = req.body;

    // Check code uniqueness
    const existing = await prisma.branch.findUnique({ where: { code } });
    if (existing) {
      sendError(res, "Branch code already exists", 400);
      return;
    }

    // Get organization from super admin
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user?.organizationId) {
      sendError(res, "No organization found for this user", 400);
      return;
    }

    const branch = await prisma.branch.create({
      data: {
        organizationId: user.organizationId,
        name,
        code,
        address,
        city,
        state,
        pincode,
        phone,
        email,
        isActive: true,
      },
    });

    sendSuccess(res, branch, "Branch created successfully", 201);
  } catch (error) {
    sendError(res, "Failed to create branch", 500, (error as Error).message);
  }
};

/**
 * Get all branches (Super Admin sees all, Branch Admin sees own)
 */
export const getBranches = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;
    const search = req.query.search as string;

    const where: any = {};

    // Branch Admin can only see their own branch
    if (req.user!.role !== UserRole.SUPER_ADMIN) {
      where.id = req.user!.branchId;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { code: { contains: search, mode: "insensitive" } },
        { city: { contains: search, mode: "insensitive" } },
      ];
    }

    const [branches, total] = await Promise.all([
      prisma.branch.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: "asc" },
        include: {
          _count: {
            select: { students: true, staff: true },
          },
        },
      }),
      prisma.branch.count({ where }),
    ]);

    sendPaginated(res, branches, total, page, limit, "Branches fetched");
  } catch (error) {
    sendError(res, "Failed to fetch branches", 500, (error as Error).message);
  }
};

/**
 * Get single branch by ID
 */
export const getBranchById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // SECURITY: Branch Admins can only ever look up their own branch.
    if (req.user!.role !== UserRole.SUPER_ADMIN && id !== req.user!.branchId) {
      sendError(res, "Branch not found", 404);
      return;
    }

    const branch = await prisma.branch.findUnique({
      where: { id },
      include: {
        _count: {
          select: { students: true, staff: true, classes: true },
        },
      },
    });

    if (!branch) {
      sendError(res, "Branch not found", 404);
      return;
    }

    sendSuccess(res, branch, "Branch fetched");
  } catch (error) {
    sendError(res, "Failed to fetch branch", 500, (error as Error).message);
  }
};

/**
 * Update branch
 */
export const updateBranch = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, address, city, state, pincode, phone, email, isActive, logo } = req.body;

    const branch = await prisma.branch.findUnique({ where: { id } });
    if (!branch) {
      sendError(res, "Branch not found", 404);
      return;
    }

    const updated = await prisma.branch.update({
      where: { id },
      data: { name, address, city, state, pincode, phone, email, isActive, logo },
    });

    sendSuccess(res, updated, "Branch updated successfully");
  } catch (error) {
    sendError(res, "Failed to update branch", 500, (error as Error).message);
  }
};
