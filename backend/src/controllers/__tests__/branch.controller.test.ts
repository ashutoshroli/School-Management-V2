import { UserRole } from "@prisma/client";

jest.mock("bcryptjs", () => ({
  hash: jest.fn().mockResolvedValue("hashed-password"),
}));

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    branch: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    staff: { count: jest.fn(), create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { createBranchAdmin, getBranchAdmins, setBranchAdminStatus } from "../branch.controller";
import { AuthRequest } from "../../types";

const makeMockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const makeReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
  ({
    body: {},
    params: {},
    query: {},
    user: { userId: "super-1", email: "super@test.com", role: UserRole.SUPER_ADMIN, organizationId: "org-1" },
    ...overrides,
  } as any);

describe("branch.controller - createBranchAdmin", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.branch.findUnique as jest.Mock).mockResolvedValue({ id: "branch-2", name: "North Campus", code: "NORTH" });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.staff.count as jest.Mock).mockResolvedValue(0);
    (prisma.user.create as jest.Mock).mockResolvedValue({ id: "user-1" });
    (prisma.staff.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "staff-1", ...data }));
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({
      id: "staff-1",
      user: { name: "Priya Admin", email: "priya@test.com", phone: null, role: UserRole.BRANCH_ADMIN },
      branch: { id: "branch-2", name: "North Campus" },
    });
  });

  it("creates a BRANCH_ADMIN user assigned to the given branch", async () => {
    const req = makeReq({ body: { branchId: "branch-2", name: "Priya Admin", email: "priya@test.com" } });
    const res = makeMockRes();

    await createBranchAdmin(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const userCreateCall = (prisma.user.create as jest.Mock).mock.calls[0][0];
    expect(userCreateCall.data.role).toBe(UserRole.BRANCH_ADMIN);
    const staffCreateCall = (prisma.staff.create as jest.Mock).mock.calls[0][0];
    expect(staffCreateCall.data.branchId).toBe("branch-2");
  });

  it("returns 400 when branchId is missing", async () => {
    const req = makeReq({ body: { name: "Priya Admin", email: "priya@test.com" } });
    const res = makeMockRes();

    await createBranchAdmin(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("returns 404 when the target branch does not exist", async () => {
    (prisma.branch.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ body: { branchId: "does-not-exist", name: "Priya Admin", email: "priya@test.com" } });
    const res = makeMockRes();

    await createBranchAdmin(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("rejects a duplicate email", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: "existing-user" });
    const req = makeReq({ body: { branchId: "branch-2", name: "Priya Admin", email: "priya@test.com" } });
    const res = makeMockRes();

    await createBranchAdmin(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  // BUG FIX: Staff.employeeId is globally unique, but was previously
  // generated from a branch-scoped count alone (e.g. "EMP-0001") - the
  // first Branch Admin created for ANY second branch collided with an
  // identical employeeId already used elsewhere and crashed with a
  // Prisma unique-constraint violation ("Failed to create Branch
  // Admin"). Regression-tests that the branch's own (globally unique)
  // code is now included in the generated employeeId.
  it("BUG FIX: generates a branch-code-qualified employeeId so it can't collide across branches", async () => {
    const req = makeReq({ body: { branchId: "branch-2", name: "Priya Admin", email: "priya@test.com" } });
    const res = makeMockRes();

    await createBranchAdmin(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const staffCreateCall = (prisma.staff.create as jest.Mock).mock.calls[0][0];
    expect(staffCreateCall.data.employeeId).toBe("EMP-NORTH-0001");
    expect(staffCreateCall.data.employeeId).not.toBe("EMP-0001");
  });

  // Blank-password regression - the "Add Branch Admin" form leaves
  // password blank by default (submits as "" not undefined); this
  // confirms the controller's own fallback still kicks in once the
  // (already-fixed) validator lets "" through.
  it("falls back to the default password when an empty string is sent", async () => {
    const bcrypt = require("bcryptjs");
    const req = makeReq({ body: { branchId: "branch-2", name: "Priya Admin", email: "priya@test.com", password: "" } });
    const res = makeMockRes();

    await createBranchAdmin(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(bcrypt.hash).toHaveBeenCalledWith("Admin@123", 12);
  });
});

describe("branch.controller - getBranchAdmins", () => {
  beforeEach(() => jest.clearAllMocks());

  it("only returns staff whose user role is BRANCH_ADMIN", async () => {
    (prisma.staff.findMany as jest.Mock).mockResolvedValue([]);
    const req = makeReq();
    const res = makeMockRes();

    await getBranchAdmins(req, res);

    expect(prisma.staff.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { user: { role: UserRole.BRANCH_ADMIN } } })
    );
  });
});

describe("branch.controller - setBranchAdminStatus", () => {
  beforeEach(() => jest.clearAllMocks());

  it("deactivates both the User and Staff records for a Branch Admin", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({
      id: "staff-1", userId: "user-1", user: { role: UserRole.BRANCH_ADMIN },
    });

    const req = makeReq({ params: { staffId: "staff-1" }, body: { isActive: false } });
    const res = makeMockRes();

    await setBranchAdminStatus(req, res);

    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: "user-1" }, data: { isActive: false } });
    expect(prisma.staff.update).toHaveBeenCalledWith({ where: { id: "staff-1" }, data: { isActive: false } });
  });

  it("returns 404 when the staff record isn't actually a Branch Admin", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({
      id: "staff-1", userId: "user-1", user: { role: UserRole.TEACHER },
    });

    const req = makeReq({ params: { staffId: "staff-1" }, body: { isActive: false } });
    const res = makeMockRes();

    await setBranchAdminStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
