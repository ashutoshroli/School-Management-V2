import { Response } from "express";
import { UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError, sendPaginated } from "../utils/response";
import { resolveBranchId, resolveEffectiveBranchId, canAccessBranch } from "../utils/branchScope";

/**
 * Roles a Branch Admin is allowed to assign when creating a staff
 * member for their own branch. Deliberately excludes BRANCH_ADMIN and
 * SUPER_ADMIN - a Branch Admin must never be able to mint another
 * admin (privilege escalation) via this endpoint.
 */
const BRANCH_ADMIN_ASSIGNABLE_ROLES: UserRole[] = [
  UserRole.TEACHER,
  UserRole.ACCOUNTANT,
  UserRole.LIBRARIAN,
  UserRole.TRANSPORT_MANAGER,
  UserRole.WARDEN,
  UserRole.STAFF,
];

/**
 * Create staff member.
 *
 * SECURITY: `role` used to be taken straight from req.body with no
 * validation at all - a Branch Admin could send `role: "SUPER_ADMIN"`
 * (or "BRANCH_ADMIN") in the create-staff payload and mint themselves
 * (or anyone) a full admin account for their branch/org. Only
 * SUPER_ADMIN may assign BRANCH_ADMIN here (that's how a Super Admin
 * hands a branch off to be self-managed); SUPER_ADMIN itself can never
 * be assigned via this endpoint since a Super Admin has no Staff
 * record / branch of their own.
 */
export const createStaff = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      name, email, phone, password,
      designation, department, type, qualification, experience,
      joiningDate, bankAccount, bankName, ifscCode, panNumber,
      aadharNumber, address, city, state, pincode, cardId, role,
    } = req.body;
    // BUG FIX: the "Add Staff" form has no branch-picker, so
    // req.body.branchId always arrived as "" - see
    // resolveEffectiveBranchId's doc comment.
    const branchId = resolveEffectiveBranchId(req, req.body.branchId);

    if (!branchId) {
      sendError(res, "Branch ID could not be resolved - please select a branch", 400);
      return;
    }

    // SECURITY: Branch Admins may only create staff for their own branch.
    if (!canAccessBranch(req, branchId)) {
      sendError(res, "Access denied: branch mismatch", 403);
      return;
    }

    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch) {
      sendError(res, "Branch not found", 404);
      return;
    }

    // Determine user role
    const requestedRole: UserRole | undefined = role;
    const defaultRole = type === "TEACHING" ? UserRole.TEACHER : UserRole.STAFF;

    if (requestedRole === UserRole.SUPER_ADMIN) {
      sendError(res, "Cannot create a Super Admin via staff creation", 400);
      return;
    }
    if (
      requestedRole === UserRole.BRANCH_ADMIN &&
      req.user!.role !== UserRole.SUPER_ADMIN
    ) {
      sendError(res, "Only a Super Admin can assign the Branch Admin role", 403);
      return;
    }
    if (
      requestedRole &&
      req.user!.role !== UserRole.SUPER_ADMIN &&
      !BRANCH_ADMIN_ASSIGNABLE_ROLES.includes(requestedRole)
    ) {
      sendError(res, "Invalid role for a Branch Admin to assign", 400);
      return;
    }

    const userRole = requestedRole || defaultRole;

    // Check email uniqueness
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      sendError(res, "Email already exists", 400);
      return;
    }

    // BUG FIX: Staff.employeeId is globally unique (@unique, not
    // @@unique([branchId, ...])), but this used to generate it from a
    // branch-scoped count alone (e.g. "EMP-0001") - the first staff
    // member created in ANY second branch collided with the first
    // branch's "EMP-0001" and crashed with a Prisma unique-constraint
    // violation, surfacing as a generic "Failed to create staff".
    // Including the branch's own (globally unique) code makes this
    // string unique across branches too.
    const count = await prisma.staff.count({ where: { branchId } });
    const employeeId = `EMP-${branch.code}-${String(count + 1).padStart(4, "0")}`;

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

/**
 * Permanently delete a staff member and their linked User account.
 *
 * Blocked if the staff member has any Payslip history - a payslip is
 * financial/payroll record-keeping that must never disappear (an
 * accountant may need to reference it long after the person has left);
 * deactivate the staff record instead (PUT .../:id with isActive:
 * false, already supported by updateStaff) rather than deleting it.
 *
 * Otherwise, deletes every lightweight dependent row first (documents,
 * subject-teacher assignments, salary structure, attendance, leave
 * applications) and clears any class-teacher assignment, all inside one
 * transaction so a failure partway through can't leave an orphaned
 * User with no Staff record.
 */
export const deleteStaff = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const staff = await prisma.staff.findUnique({ where: { id } });
    if (!staff) { sendError(res, "Staff not found", 404); return; }
    if (!canAccessBranch(req, staff.branchId)) { sendError(res, "Staff not found", 404); return; }

    const payslipCount = await prisma.payslip.count({ where: { staffId: id } });
    if (payslipCount > 0) {
      sendError(res, `Cannot delete: this staff member has ${payslipCount} payslip record(s). Deactivate them instead (edit > set inactive).`, 400);
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.section.updateMany({ where: { classTeacherId: id }, data: { classTeacherId: null } });
      await tx.timetableSlot.updateMany({ where: { teacherId: id }, data: { teacherId: null } });
      await tx.staffDocument.deleteMany({ where: { staffId: id } });
      await tx.subjectTeacher.deleteMany({ where: { staffId: id } });
      await tx.staffAttendance.deleteMany({ where: { staffId: id } });
      await tx.leaveApplication.deleteMany({ where: { staffId: id } });
      await tx.salaryStructure.deleteMany({ where: { staffId: id } });
      await tx.staff.delete({ where: { id } });
      await tx.user.delete({ where: { id: staff.userId } });
    });

    sendSuccess(res, null, "Staff deleted");
  } catch (error) {
    sendError(res, "Failed to delete staff", 500, (error as Error).message);
  }
};
