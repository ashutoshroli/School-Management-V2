import { Response } from "express";
import { UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";
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

/**
 * SUPER_ADMIN only. Creates a Branch Admin account and assigns them to
 * a specific branch in one step - this is how a Super Admin hands a
 * branch off to be self-managed day-to-day.
 *
 * Modeled closely on staff.controller.ts's createStaff (a Branch Admin
 * is stored as a Staff record with role=BRANCH_ADMIN, designation
 * defaulted to "Branch Admin", type NON_TEACHING) rather than
 * introducing a separate table - every branch-scoped query in this app
 * already resolves a caller's branch via their Staff.branchId, so a
 * Branch Admin needs that same linkage to inherit branch access
 * anywhere (canAccessBranch, resolveEffectiveBranchId, etc).
 */
export const createBranchAdmin = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, email, phone, password, branchId } = req.body;

    if (!branchId) {
      sendError(res, "branchId is required", 400);
      return;
    }

    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch) {
      sendError(res, "Branch not found", 404);
      return;
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      sendError(res, "Email already exists", 400);
      return;
    }

    const count = await prisma.staff.count({ where: { branchId } });
    const employeeId = `EMP-${String(count + 1).padStart(4, "0")}`;
    const hashedPassword = await bcrypt.hash(password || "Admin@123", 12);

    const user = await prisma.user.create({
      data: {
        email,
        name,
        phone,
        password: hashedPassword,
        role: UserRole.BRANCH_ADMIN,
        organizationId: req.user!.organizationId || undefined,
        isActive: true,
      },
    });

    const staff = await prisma.staff.create({
      data: {
        userId: user.id,
        branchId,
        employeeId,
        designation: "Branch Admin",
        department: "Administration",
        type: "NON_TEACHING",
        joiningDate: new Date(),
        isActive: true,
      },
    });

    const fullStaff = await prisma.staff.findUnique({
      where: { id: staff.id },
      include: {
        user: { select: { name: true, email: true, phone: true, role: true } },
        branch: { select: { id: true, name: true } },
      },
    });

    sendSuccess(res, fullStaff, "Branch Admin created successfully", 201);
  } catch (error) {
    sendError(res, "Failed to create Branch Admin", 500, (error as Error).message);
  }
};

/**
 * SUPER_ADMIN only. Lists every Branch Admin across the organization,
 * with the branch each one is assigned to - the counterpart list view
 * to createBranchAdmin above.
 */
export const getBranchAdmins = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const admins = await prisma.staff.findMany({
      where: { user: { role: UserRole.BRANCH_ADMIN } },
      orderBy: { user: { name: "asc" } },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, isActive: true, avatar: true } },
        branch: { select: { id: true, name: true, code: true } },
      },
    });

    sendSuccess(res, admins, "Branch Admins fetched");
  } catch (error) {
    sendError(res, "Failed to fetch Branch Admins", 500, (error as Error).message);
  }
};

/**
 * SUPER_ADMIN only. Activates/deactivates a Branch Admin's account
 * (e.g. offboarding, or temporarily revoking access) without deleting
 * their history. Deactivated accounts are rejected at login (see
 * auth.controller.ts's login - checks user.isActive).
 */
export const setBranchAdminStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { staffId } = req.params;
    const { isActive } = req.body;

    const staff = await prisma.staff.findUnique({ where: { id: staffId }, include: { user: true } });
    if (!staff || staff.user.role !== UserRole.BRANCH_ADMIN) {
      sendError(res, "Branch Admin not found", 404);
      return;
    }

    await prisma.user.update({ where: { id: staff.userId }, data: { isActive } });
    await prisma.staff.update({ where: { id: staff.id }, data: { isActive } });

    sendSuccess(res, null, isActive ? "Branch Admin activated" : "Branch Admin deactivated");
  } catch (error) {
    sendError(res, "Failed to update Branch Admin status", 500, (error as Error).message);
  }
};
