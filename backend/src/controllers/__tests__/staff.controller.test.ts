import { UserRole } from "@prisma/client";

jest.mock("bcryptjs", () => ({
  hash: jest.fn().mockResolvedValue("hashed-password"),
}));

jest.mock("../../services/auditLog.service", () => ({
  logAuditFromRequest: jest.fn(),
}));

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    staff: { count: jest.fn(), create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
    branch: { findUnique: jest.fn() },
  },
}));

import bcrypt from "bcryptjs";
import prisma from "../../config/database";
import { createStaff, resetStaffPassword, getStaffList } from "../staff.controller";
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
    (prisma.branch.findUnique as jest.Mock).mockResolvedValue({ id: "branch-1", code: "MAIN" });
  });

  it("returns 404 when the resolved branch does not exist", async () => {
    (prisma.branch.findUnique as jest.Mock).mockResolvedValue(null);

    const req = makeReq({ body: { ...baseBody, branchId: "" } });
    const res = makeMockRes();

    await createStaff(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.staff.create).not.toHaveBeenCalled();
  });

  // BUG FIX: Staff.employeeId is globally unique (not scoped per
  // branch), but was previously generated from a branch-scoped count
  // alone (e.g. "EMP-0001") - the first staff member created in ANY
  // second branch collided with an identical employeeId already used
  // by the first branch and crashed with a Prisma unique-constraint
  // violation ("Failed to create staff"). This regression-tests that
  // the branch's own (globally unique) code is now included, so two
  // different branches never generate the same employeeId even when
  // both are creating their very first staff member.
  it("BUG FIX: generates a branch-code-qualified employeeId so it can't collide across branches", async () => {
    (prisma.branch.findUnique as jest.Mock).mockResolvedValue({ id: "branch-2", code: "NORTH" });
    (prisma.staff.count as jest.Mock).mockResolvedValue(0);

    const req = makeReq({
      body: { ...baseBody, branchId: "" },
      user: { userId: "admin-2", email: "admin2@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-2" },
    });
    const res = makeMockRes();

    await createStaff(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const staffCreateCall = (prisma.staff.create as jest.Mock).mock.calls[0][0];
    expect(staffCreateCall.data.employeeId).toBe("EMP-NORTH-0001");
    // Explicitly NOT the bare "EMP-0001" a first branch would also
    // generate for its own first staff member with count=0.
    expect(staffCreateCall.data.employeeId).not.toBe("EMP-0001");
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

  // BUG FIX: Staff.cardId is an OPTIONAL @unique column (RFID Card ID).
  // The "Add Staff" form always sends cardId: "" when the field is
  // left blank (the common case). An empty string is a real, distinct
  // value to Postgres (unlike NULL, which @unique permits any number
  // of), so the FIRST staff member created with a blank card ID
  // succeeded and every subsequent one crashed on a unique-constraint
  // violation on cardId: "" - this is the actual root cause behind
  // repeated "Failed to add staff" reports.
  it("BUG FIX: normalizes a blank cardId (\"\") to undefined instead of writing an empty string", async () => {
    const req = makeReq({ body: { ...baseBody, cardId: "" } });
    const res = makeMockRes();

    await createStaff(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const staffCreateCall = (prisma.staff.create as jest.Mock).mock.calls[0][0];
    expect(staffCreateCall.data.cardId).toBeUndefined();
  });

  it("preserves a real, non-blank cardId value", async () => {
    const req = makeReq({ body: { ...baseBody, cardId: "RFID-99999" } });
    const res = makeMockRes();

    await createStaff(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const staffCreateCall = (prisma.staff.create as jest.Mock).mock.calls[0][0];
    expect(staffCreateCall.data.cardId).toBe("RFID-99999");
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

describe("staff.controller - resetStaffPassword", () => {
  const STAFF = {
    id: "staff-1",
    branchId: "branch-1",
    userId: "user-1",
    user: { id: "user-1", name: "Jane Teacher", email: "jane@test.com" },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (bcrypt.hash as jest.Mock).mockResolvedValue("hashed-one-time-password");
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue(STAFF);
    (prisma.user.update as jest.Mock).mockResolvedValue({});
  });

  it("returns 404 when the staff member does not exist", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { id: "staff-1" } });
    const res = makeMockRes();

    await resetStaffPassword(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("SECURITY: rejects a staff member from a different branch", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ ...STAFF, branchId: "branch-OTHER" });
    const req = makeReq({ params: { id: "staff-1" } });
    const res = makeMockRes();

    await resetStaffPassword(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("hashes and saves a new password on the staff member's own User record", async () => {
    const req = makeReq({ params: { id: "staff-1" } });
    const res = makeMockRes();

    await resetStaffPassword(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { password: "hashed-one-time-password" },
    });
    expect((bcrypt.hash as jest.Mock).mock.calls[0][1]).toBe(12);
  });

  it("returns the plaintext one-time password in the response, and does not include it in the audit log", async () => {
    const req = makeReq({ params: { id: "staff-1" } });
    const res = makeMockRes();

    await resetStaffPassword(req, res);

    const jsonPayload = (res.json as jest.Mock).mock.calls[0][0];
    expect(jsonPayload.data.oneTimePassword).toBeDefined();
    expect(jsonPayload.data.oneTimePassword).not.toBe("hashed-one-time-password");
    expect(jsonPayload.data.email).toBe("jane@test.com");

    const { logAuditFromRequest } = require("../../services/auditLog.service");
    expect(logAuditFromRequest).toHaveBeenCalledTimes(1);
    const auditCallArgs = JSON.stringify(logAuditFromRequest.mock.calls[0]);
    expect(auditCallArgs).not.toContain(jsonPayload.data.oneTimePassword);
  });
});

// Backend UX Gap Phase 3: getStaffList previously had no `designation`
// filter at all, even though department/type already existed.
describe("staff.controller - getStaffList (designation filter)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.staff.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.staff.count as jest.Mock).mockResolvedValue(0);
  });

  it("filters by designation when provided", async () => {
    const req = makeReq({ query: { designation: "PGT" } });
    const res = makeMockRes();

    await getStaffList(req, res);

    expect(prisma.staff.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ designation: "PGT" }) })
    );
  });

  it("omits the designation filter when not provided", async () => {
    const req = makeReq({ query: {} });
    const res = makeMockRes();

    await getStaffList(req, res);

    const whereArg = (prisma.staff.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.designation).toBeUndefined();
  });

  it("combines designation with department/type filters", async () => {
    const req = makeReq({ query: { designation: "PGT", department: "Science", type: "TEACHING" } });
    const res = makeMockRes();

    await getStaffList(req, res);

    expect(prisma.staff.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ designation: "PGT", department: "Science", type: "TEACHING" }) })
    );
  });
});
