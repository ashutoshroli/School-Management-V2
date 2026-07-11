import { UserRole } from "@prisma/client";

jest.mock("bcryptjs", () => ({
  hash: jest.fn().mockResolvedValue("hashed-password"),
}));

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn(), create: jest.fn() },
    staff: { count: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { createStaff } from "../staff.controller";
import { AuthRequest } from "../../types";

const makeMockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const baseBody = {
  name: "Jane Teacher",
  email: "jane@test.com",
  phone: "9876543210",
  designation: "PGT",
  department: "Science",
  type: "TEACHING",
  joiningDate: "2024-06-01",
};

const makeReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
  ({
    body: { ...baseBody },
    params: {},
    query: {},
    user: { userId: "admin-1", email: "admin@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" },
    ...overrides,
  } as any);

describe("staff.controller - createStaff", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.staff.count as jest.Mock).mockResolvedValue(0);
    (prisma.user.create as jest.Mock).mockResolvedValue({ id: "user-1" });
    (prisma.staff.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "staff-1", ...data }));
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: "staff-1" });
  });

  it("BUG FIX: creates staff under the caller's own branch when the client sends an empty branchId", async () => {
    const req = makeReq({ body: { ...baseBody, branchId: "" } });
    const res = makeMockRes();

    await createStaff(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const staffCreateCall = (prisma.staff.create as jest.Mock).mock.calls[0][0];
    expect(staffCreateCall.data.branchId).toBe("branch-1");
  });

  it("BUG FIX: creates staff under the caller's own branch when branchId is omitted entirely", async () => {
    const req = makeReq({ body: { ...baseBody } });
    const res = makeMockRes();

    await createStaff(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const staffCreateCall = (prisma.staff.create as jest.Mock).mock.calls[0][0];
    expect(staffCreateCall.data.branchId).toBe("branch-1");
  });

  it("returns 400 when no branchId can be resolved", async () => {
    const req = makeReq({
      body: { ...baseBody, branchId: "" },
      user: { userId: "u1", email: "e", role: UserRole.ACCOUNTANT, branchId: undefined },
    });
    const res = makeMockRes();

    await createStaff(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.staff.create).not.toHaveBeenCalled();
  });

  it("SECURITY: silently neutralizes a Branch Admin trying to target a different branch (creates under their own branch instead)", async () => {
    const req = makeReq({ body: { ...baseBody, branchId: "branch-OTHER" } });
    const res = makeMockRes();

    await createStaff(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const staffCreateCall = (prisma.staff.create as jest.Mock).mock.calls[0][0];
    expect(staffCreateCall.data.branchId).toBe("branch-1");
  });

  it("rejects when the email already exists", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: "existing-user" });

    const req = makeReq({ body: { ...baseBody, branchId: "" } });
    const res = makeMockRes();

    await createStaff(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.staff.create).not.toHaveBeenCalled();
  });

  it("SUPER_ADMIN can create staff in any branch by explicitly sending its branchId", async () => {
    const req = makeReq({
      body: { ...baseBody, branchId: "branch-target" },
      user: { userId: "super-1", email: "super@test.com", role: UserRole.SUPER_ADMIN, branchId: "branch-1" },
    });
    const res = makeMockRes();

    await createStaff(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const staffCreateCall = (prisma.staff.create as jest.Mock).mock.calls[0][0];
    expect(staffCreateCall.data.branchId).toBe("branch-target");
  });

  // SECURITY: `role` used to be taken straight from req.body with zero
  // validation - a Branch Admin could self-escalate by sending
  // role: "SUPER_ADMIN" (or "BRANCH_ADMIN") in an otherwise-normal
  // create-staff request. These regression-test the fix.
  describe("SECURITY: role assignment restrictions", () => {
    it("rejects a Branch Admin trying to assign SUPER_ADMIN to a new staff member", async () => {
      const req = makeReq({ body: { ...baseBody, role: UserRole.SUPER_ADMIN } });
      const res = makeMockRes();

      await createStaff(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it("rejects SUPER_ADMIN itself trying to assign the SUPER_ADMIN role via this endpoint", async () => {
      const req = makeReq({
        body: { ...baseBody, role: UserRole.SUPER_ADMIN },
        user: { userId: "super-1", email: "super@test.com", role: UserRole.SUPER_ADMIN, branchId: "branch-1" },
      });
      const res = makeMockRes();

      await createStaff(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it("rejects a Branch Admin trying to assign the BRANCH_ADMIN role to a new staff member", async () => {
      const req = makeReq({ body: { ...baseBody, role: UserRole.BRANCH_ADMIN } });
      const res = makeMockRes();

      await createStaff(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it("allows SUPER_ADMIN to assign the BRANCH_ADMIN role", async () => {
      const req = makeReq({
        body: { ...baseBody, role: UserRole.BRANCH_ADMIN },
        user: { userId: "super-1", email: "super@test.com", role: UserRole.SUPER_ADMIN, branchId: "branch-1" },
      });
      const res = makeMockRes();

      await createStaff(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      const userCreateCall = (prisma.user.create as jest.Mock).mock.calls[0][0];
      expect(userCreateCall.data.role).toBe(UserRole.BRANCH_ADMIN);
    });

    it("allows a Branch Admin to assign an ordinary staff role like ACCOUNTANT", async () => {
      const req = makeReq({ body: { ...baseBody, role: UserRole.ACCOUNTANT } });
      const res = makeMockRes();

      await createStaff(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      const userCreateCall = (prisma.user.create as jest.Mock).mock.calls[0][0];
      expect(userCreateCall.data.role).toBe(UserRole.ACCOUNTANT);
    });
  });
});
