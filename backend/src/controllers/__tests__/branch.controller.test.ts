import { UserRole } from "@prisma/client";

jest.mock("bcryptjs", () => ({
  hash: jest.fn().mockResolvedValue("hashed-password"),
}));

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    branch: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn() },
    user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    staff: { count: jest.fn(), create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    account: { findMany: jest.fn(), createMany: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { createBranch, createBranchAdmin, getBranchAdmins, setBranchAdminStatus } from "../branch.controller";
import { AuthRequest } from "../../types";
import { DEFAULT_CHART_OF_ACCOUNTS } from "../../services/defaultChartOfAccounts";

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

describe("branch.controller - createBranch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.branch.findUnique as jest.Mock).mockResolvedValue(null); // code not taken
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ organizationId: "org-1" });
    (prisma.branch.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "branch-new", ...data }));
    (prisma.account.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.account.createMany as jest.Mock).mockResolvedValue({ count: DEFAULT_CHART_OF_ACCOUNTS.length });
  });

  // BUG FIX: a branch created through this endpoint used to get NO
  // Chart of Accounts at all (only db/prisma/seed.ts's one-time demo
  // data seeded any) - the very first fee payment collected against it
  // would fail with "Failed to collect payment" because
  // autoPostToAccounting (feePayment.service.ts) requires a Cash
  // (1001) and Fee Income (3001) account to already exist. This
  // regression-tests that creating a branch now seeds those defaults
  // automatically.
  it("BUG FIX: seeds the default Chart of Accounts for the newly created branch", async () => {
    const req = makeReq({ body: { name: "North Campus", code: "NORTH" } });
    const res = makeMockRes();

    await createBranch(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(prisma.account.createMany).toHaveBeenCalledTimes(1);
    const createManyCall = (prisma.account.createMany as jest.Mock).mock.calls[0][0];
    expect(createManyCall.data).toHaveLength(DEFAULT_CHART_OF_ACCOUNTS.length);
    expect(createManyCall.data.every((a: any) => a.branchId === "branch-new")).toBe(true);
    expect(createManyCall.data.some((a: any) => a.code === "1001")).toBe(true);
    expect(createManyCall.data.some((a: any) => a.code === "3001")).toBe(true);
  });

  it("returns 400 when the branch code is already taken", async () => {
    (prisma.branch.findUnique as jest.Mock).mockResolvedValue({ id: "existing-branch" });
    const req = makeReq({ body: { name: "North Campus", code: "NORTH" } });
    const res = makeMockRes();

    await createBranch(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.branch.create).not.toHaveBeenCalled();
    expect(prisma.account.createMany).not.toHaveBeenCalled();
  });
});

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
