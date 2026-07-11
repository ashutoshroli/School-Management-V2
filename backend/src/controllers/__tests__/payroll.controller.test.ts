import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    staff: { findUnique: jest.fn(), findMany: jest.fn() },
    salaryStructure: { findUnique: jest.fn(), findMany: jest.fn(), createMany: jest.fn(), updateMany: jest.fn() },
    payslip: { findUnique: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { getSalaryStructure, getStaffPayslip, bulkAssignSalaryStructure, assignSalaryStructureToStaff } from "../payroll.controller";
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
    user: { userId: "teacher-1", email: "t@test.com", role: UserRole.TEACHER, branchId: "branch-1" },
    ...overrides,
  } as any);

// SECURITY: getSalaryStructure/getStaffPayslip previously had NO
// access check at all beyond `authenticate` - any logged-in user could
// read ANY other staff member's salary/payslip data just by supplying
// their staffId, including staff in a different branch (IDOR). These
// are regression guards for the fix (canAccessStaffRecord).
describe("payroll.controller - getSalaryStructure (IDOR fix)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("SECURITY: rejects a Teacher reading a staff member's salary structure in a DIFFERENT branch", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ branchId: "branch-OTHER", userId: "other-user" });
    const req = makeReq({ params: { staffId: "staff-victim" } });
    const res = makeMockRes();

    await getSalaryStructure(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.salaryStructure.findUnique).not.toHaveBeenCalled();
  });

  it("allows a staff member within the SAME branch to read a colleague's salary structure", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ branchId: "branch-1", userId: "other-user" });
    (prisma.salaryStructure.findUnique as jest.Mock).mockResolvedValue({ staffId: "staff-victim", netSalary: 50000 });
    const req = makeReq({ params: { staffId: "staff-victim" } });
    const res = makeMockRes();

    await getSalaryStructure(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.salaryStructure.findUnique).toHaveBeenCalledWith({ where: { staffId: "staff-victim" } });
  });

  it("allows a staff member to read their OWN salary structure", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ branchId: "branch-OTHER", userId: "teacher-1" });
    (prisma.salaryStructure.findUnique as jest.Mock).mockResolvedValue({ staffId: "staff-self" });
    const req = makeReq({ params: { staffId: "staff-self" } });
    const res = makeMockRes();

    await getSalaryStructure(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe("payroll.controller - getStaffPayslip (IDOR fix)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("SECURITY: rejects a Teacher reading another staff member's payslip in a DIFFERENT branch", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ branchId: "branch-OTHER", userId: "other-user" });
    const req = makeReq({ params: { staffId: "staff-victim", month: "3", year: "2024" } });
    const res = makeMockRes();

    await getStaffPayslip(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.payslip.findUnique).not.toHaveBeenCalled();
  });

  it("allows a staff member within the SAME branch to read a colleague's payslip", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ branchId: "branch-1", userId: "other-user" });
    (prisma.payslip.findUnique as jest.Mock).mockResolvedValue({ id: "payslip-1", netPay: 45000 });
    const req = makeReq({ params: { staffId: "staff-victim", month: "3", year: "2024" } });
    const res = makeMockRes();

    await getStaffPayslip(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });
});


// Bulk staff payment (salary structure) assignment - the payroll
// counterpart to bulkAssignFees/assignFeesToStudents for students.
describe("payroll.controller - bulkAssignSalaryStructure", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const adminReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
    makeReq({
      user: { userId: "admin-1", email: "admin@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" },
      ...overrides,
    } as any);

  it("resolves branchId server-side and rejects when it cannot be resolved", async () => {
    const req = adminReq({ user: { userId: "admin-1", email: "a@test.com", role: UserRole.SUPER_ADMIN } as any, body: { basic: 30000 } });
    const res = makeMockRes();

    await bulkAssignSalaryStructure(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.staff.findMany).not.toHaveBeenCalled();
  });

  it("SECURITY: a Branch Admin-supplied branchId is ignored - always scoped to their OWN branch (resolveEffectiveBranchId)", async () => {
    (prisma.staff.findMany as jest.Mock).mockResolvedValue([]);
    // A Branch Admin cannot smuggle in another branch's id here - non
    // SUPER_ADMIN callers are always resolved to their own req.user.branchId
    // regardless of what's in the request body (see resolveEffectiveBranchId).
    const req = adminReq({ body: { branchId: "branch-OTHER", basic: 30000 } });
    const res = makeMockRes();

    await bulkAssignSalaryStructure(req, res);

    expect(prisma.staff.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ branchId: "branch-1" }) })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("returns a zero-result summary when no staff match the filters", async () => {
    (prisma.staff.findMany as jest.Mock).mockResolvedValue([]);
    const req = adminReq({ body: { basic: 30000, department: "Nonexistent" } });
    const res = makeMockRes();

    await bulkAssignSalaryStructure(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: { created: 0, updated: 0, skipped: 0, total: 0 } })
    );
    expect(prisma.salaryStructure.createMany).not.toHaveBeenCalled();
  });

  it("filters staff by branch + type + department + designation", async () => {
    (prisma.staff.findMany as jest.Mock).mockResolvedValue([{ id: "s1" }]);
    (prisma.salaryStructure.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.salaryStructure.createMany as jest.Mock).mockResolvedValue({ count: 1 });

    const req = adminReq({
      body: { basic: 30000, type: "TEACHING", department: "Science", designation: "Senior Teacher" },
    });
    const res = makeMockRes();

    await bulkAssignSalaryStructure(req, res);

    expect(prisma.staff.findMany).toHaveBeenCalledWith({
      where: { branchId: "branch-1", isActive: true, type: "TEACHING", department: "Science", designation: "Senior Teacher" },
      select: { id: true },
    });
  });

  it("creates structures only for staff who don't already have one (skips the rest) when overwriteExisting is not set", async () => {
    (prisma.staff.findMany as jest.Mock).mockResolvedValue([{ id: "s1" }, { id: "s2" }, { id: "s3" }]);
    (prisma.salaryStructure.findMany as jest.Mock).mockResolvedValue([{ staffId: "s2" }]);
    (prisma.salaryStructure.createMany as jest.Mock).mockResolvedValue({ count: 2 });

    const req = adminReq({ body: { basic: 30000, hra: 5000 } });
    const res = makeMockRes();

    await bulkAssignSalaryStructure(req, res);

    expect(prisma.salaryStructure.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ staffId: "s1", basic: 30000 }),
        expect.objectContaining({ staffId: "s3", basic: 30000 }),
      ],
    });
    expect(prisma.salaryStructure.updateMany).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: { created: 2, updated: 0, skipped: 1, total: 3 } })
    );
  });

  it("with overwriteExisting=true, updates staff who already have a structure AND creates for the rest", async () => {
    (prisma.staff.findMany as jest.Mock).mockResolvedValue([{ id: "s1" }, { id: "s2" }]);
    (prisma.salaryStructure.findMany as jest.Mock).mockResolvedValue([{ staffId: "s2" }]);
    (prisma.salaryStructure.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.salaryStructure.createMany as jest.Mock).mockResolvedValue({ count: 1 });

    const req = adminReq({ body: { basic: 40000, overwriteExisting: true } });
    const res = makeMockRes();

    await bulkAssignSalaryStructure(req, res);

    expect(prisma.salaryStructure.updateMany).toHaveBeenCalledWith({
      where: { staffId: { in: ["s2"] } },
      data: expect.objectContaining({ basic: 40000 }),
    });
    expect(prisma.salaryStructure.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ staffId: "s1", basic: 40000 })],
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: { created: 1, updated: 1, skipped: 0, total: 2 } })
    );
  });

  it("computes PF/ESI/gross/net identically to the single-staff calculation for every matched staff member", async () => {
    (prisma.staff.findMany as jest.Mock).mockResolvedValue([{ id: "s1" }]);
    (prisma.salaryStructure.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.salaryStructure.createMany as jest.Mock).mockResolvedValue({ count: 1 });

    const req = adminReq({ body: { basic: 20000, da: 2000, hra: 8000, taxRegime: "NEW" } });
    const res = makeMockRes();

    await bulkAssignSalaryStructure(req, res);

    const createdData = (prisma.salaryStructure.createMany as jest.Mock).mock.calls[0][0].data[0];
    // basic+da = 22000 -> PF = round(22000*0.12) = 2640
    expect(createdData.pfEmployee).toBe(2640);
    expect(createdData.pfEmployer).toBe(2640);
    // gross = 20000+2000+8000 = 30000 (> 21000, so no ESI)
    expect(createdData.grossSalary).toBe(30000);
    expect(createdData.esiEmployee).toBe(0);
    expect(createdData.netSalary).toBe(30000 - 2640); // no TDS at this income level
  });
});

describe("payroll.controller - assignSalaryStructureToStaff", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const adminReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
    makeReq({
      user: { userId: "admin-1", email: "admin@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" },
      ...overrides,
    } as any);

  it("rejects when staffIds is missing/empty", async () => {
    const req = adminReq({ body: { basic: 30000, staffIds: [] } });
    const res = makeMockRes();

    await assignSalaryStructureToStaff(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.staff.findMany).not.toHaveBeenCalled();
  });

  it("rejects when one or more staffIds don't exist", async () => {
    (prisma.staff.findMany as jest.Mock).mockResolvedValue([{ id: "s1", branchId: "branch-1" }]);
    const req = adminReq({ body: { basic: 30000, staffIds: ["s1", "s-missing"] } });
    const res = makeMockRes();

    await assignSalaryStructureToStaff(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.salaryStructure.findMany).not.toHaveBeenCalled();
  });

  it("SECURITY: rejects (IDOR) if any staffId belongs to a branch the caller cannot access", async () => {
    (prisma.staff.findMany as jest.Mock).mockResolvedValue([
      { id: "s1", branchId: "branch-1" },
      { id: "s2", branchId: "branch-OTHER" },
    ]);
    const req = adminReq({ body: { basic: 30000, staffIds: ["s1", "s2"] } });
    const res = makeMockRes();

    await assignSalaryStructureToStaff(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.salaryStructure.findMany).not.toHaveBeenCalled();
  });

  it("creates a salary structure for each hand-picked staff member, skipping those who already have one", async () => {
    (prisma.staff.findMany as jest.Mock).mockResolvedValue([
      { id: "s1", branchId: "branch-1" },
      { id: "s2", branchId: "branch-1" },
    ]);
    (prisma.salaryStructure.findMany as jest.Mock).mockResolvedValue([{ staffId: "s2" }]);
    (prisma.salaryStructure.createMany as jest.Mock).mockResolvedValue({ count: 1 });

    const req = adminReq({ body: { basic: 35000, staffIds: ["s1", "s2"] } });
    const res = makeMockRes();

    await assignSalaryStructureToStaff(req, res);

    expect(prisma.salaryStructure.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ staffId: "s1", basic: 35000 })],
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: { created: 1, updated: 0, skipped: 1, total: 2 } })
    );
  });

  it("with overwriteExisting=true, updates every already-assigned staff member in the list too", async () => {
    (prisma.staff.findMany as jest.Mock).mockResolvedValue([
      { id: "s1", branchId: "branch-1" },
      { id: "s2", branchId: "branch-1" },
    ]);
    (prisma.salaryStructure.findMany as jest.Mock).mockResolvedValue([{ staffId: "s1" }, { staffId: "s2" }]);
    (prisma.salaryStructure.updateMany as jest.Mock).mockResolvedValue({ count: 2 });

    const req = adminReq({ body: { basic: 50000, staffIds: ["s1", "s2"], overwriteExisting: true } });
    const res = makeMockRes();

    await assignSalaryStructureToStaff(req, res);

    expect(prisma.salaryStructure.updateMany).toHaveBeenCalledWith({
      where: { staffId: { in: ["s1", "s2"] } },
      data: expect.objectContaining({ basic: 50000 }),
    });
    expect(prisma.salaryStructure.createMany).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: { created: 0, updated: 2, skipped: 0, total: 2 } })
    );
  });
});
