import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    staff: { findUnique: jest.fn() },
    salaryStructure: { findUnique: jest.fn() },
    payslip: { findUnique: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { getSalaryStructure, getStaffPayslip } from "../payroll.controller";
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
