import { Response } from "express";
import { UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError, sendPaginated } from "../utils/response";
import { resolveBranchId, canAccessBranch } from "../utils/branchScope";

/**
 * Create staff member
 */
export const createStaff = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      branchId, name, email, phone, password,
      designation, department, type, qualification, experience,
      joiningDate, bankAccount, bankName, ifscCode, panNumber,
      aadharNumber, address, city, state, pincode, cardId, role,
    } = req.body;

    // SECURITY: Branch Admins may only create staff for their own branch.
    if (!canAccessBranch(req, branchId)) {
      sendError(res, "Access denied: branch mismatch", 403);
      return;
    }

    // Check email uniqueness
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      sendError(res, "Email already exists", 400);
      return;
    }

    // Generate employee ID
    const count = await prisma.staff.count({ where: { branchId } });
    const employeeId = `EMP-${String(count + 1).padStart(4, "0")}`;

    // Determine user role
    const userRole = role || (type === "TEACHING" ? UserRole.TEACHER : UserRole.STAFF);

    // Hash password
    const hashedPassword = await bcrypt.hash(password || "Staff@123", 12);

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        name,
        phone,
        password: hashedPassword,
        role: userRole,
        organizationId: req.user!.organizationId || undefined,
        isActive: true,
      },
    });

    // Create staff record
    const staff = await prisma.staff.create({
      data: {
        userId: user.id,
        branchId,
        employeeId,
        designation,
        department,
        type: type || "TEACHING",
        qualification,
        experience,
        joiningDate: new Date(joiningDate),
        bankAccount,
        bankName,
        ifscCode,
        panNumber,
        aadharNumber,
        address,
        city,
        state,
        pincode,
        cardId,
        isActive: true,
      },
    });

    // Fetch complete record
    const fullStaff = await prisma.staff.findUnique({
      where: { id: staff.id },
      include: {
        user: { select: { name: true, email: true, phone: true, role: true } },
      },
    });

    sendSuccess(res, fullStaff, "Staff created successfully", 201);
  } catch (error) {
    sendError(res, "Failed to create staff", 500, (error as Error).message);
  }
};

/**
 * Get staff list
 */
export const getStaffList = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 25;
    const skip = (page - 1) * limit;
    const branchId = resolveBranchId(req);
    const type = req.query.type as string; // TEACHING | NON_TEACHING
    const department = req.query.department as string;
    const search = req.query.search as string;
    const isActive = req.query.isActive !== "false";

    const where: any = { isActive };
    if (branchId) where.branchId = branchId;
    if (type) where.type = type;
    if (department) where.department = department;

    if (search) {
      where.OR = [
        { employeeId: { contains: search, mode: "insensitive" } },
        { user: { name: { contains: search, mode: "insensitive" } } },
        { user: { email: { contains: search, mode: "insensitive" } } },
        { designation: { contains: search, mode: "insensitive" } },
      ];
    }

    const [staffList, total] = await Promise.all([
      prisma.staff.findMany({
        where,
        skip,
        take: limit,
        orderBy: { user: { name: "asc" } },
        include: {
          user: { select: { name: true, email: true, phone: true, role: true, avatar: true } },
        },
      }),
      prisma.staff.count({ where }),
    ]);

    sendPaginated(res, staffList, total, page, limit, "Staff list fetched");
  } catch (error) {
    sendError(res, "Failed to fetch staff", 500, (error as Error).message);
  }
};

/**
 * Get single staff profile
 */
export const getStaffById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const staff = await prisma.staff.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, role: true, avatar: true } },
        branch: { select: { id: true, name: true } },
        documents: true,
        salaryStructure: true,
      },
    });

    if (!staff) {
      sendError(res, "Staff not found", 404);
      return;
    }

    // SECURITY: prevent cross-branch access (IDOR)
    if (!canAccessBranch(req, staff.branchId)) {
      sendError(res, "Staff not found", 404);
      return;
    }

    sendSuccess(res, staff, "Staff profile fetched");
  } catch (error) {
    sendError(res, "Failed to fetch staff", 500, (error as Error).message);
  }
};

/**
 * Update staff profile
 */
export const updateStaff = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const {
      name, phone, designation, department, type, qualification, experience,
      bankAccount, bankName, ifscCode, panNumber, aadharNumber,
      address, city, state, pincode, cardId, isActive, leavingDate,
    } = req.body;

    const staff = await prisma.staff.findUnique({ where: { id } });
    if (!staff) {
      sendError(res, "Staff not found", 404);
      return;
    }

    if (!canAccessBranch(req, staff.branchId)) {
      sendError(res, "Staff not found", 404);
      return;
    }

    // Update staff
    const updated = await prisma.staff.update({
      where: { id },
      data: {
        ...(designation && { designation }),
        ...(department && { department }),
        ...(type && { type }),
        ...(qualification !== undefined && { qualification }),
        ...(experience !== undefined && { experience }),
        ...(bankAccount !== undefined && { bankAccount }),
        ...(bankName !== undefined && { bankName }),
        ...(ifscCode !== undefined && { ifscCode }),
        ...(panNumber !== undefined && { panNumber }),
        ...(aadharNumber !== undefined && { aadharNumber }),
        ...(address !== undefined && { address }),
        ...(city !== undefined && { city }),
        ...(state !== undefined && { state }),
        ...(pincode !== undefined && { pincode }),
        ...(cardId !== undefined && { cardId }),
        ...(isActive !== undefined && { isActive }),
        ...(leavingDate && { leavingDate: new Date(leavingDate) }),
      },
    });

    // Update user name/phone if provided
    if (name || phone) {
      await prisma.user.update({
        where: { id: staff.userId },
        data: { ...(name && { name }), ...(phone && { phone }) },
      });
    }

    sendSuccess(res, updated, "Staff updated");
  } catch (error) {
    sendError(res, "Failed to update staff", 500, (error as Error).message);
  }
};
