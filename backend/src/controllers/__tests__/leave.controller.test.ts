import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    staff: { findUnique: jest.fn() },
    leaveApplication: { findMany: jest.fn(), aggregate: jest.fn() },
    leaveType: { findMany: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { getLeaveApplications, getLeaveBalance } from "../leave.controller";
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

// SECURITY: passing ?staffId=<anyone> used to skip branch scoping
// entirely with no ownership check either - any authenticated user
// could read another staff member's full leave application history
// (including their stated reason), even cross-branch (IDOR). These are
// regression guards for the fix (canAccessStaffRecord).
describe("leave.controller - getLeaveApplications (IDOR fix)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("SECURITY: rejects ?staffId=<victim> when the victim is in a DIFFERENT branch", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ branchId: "branch-OTHER", userId: "victim-user" });
    const req = makeReq({ query: { staffId: "staff-victim" } });
    const res = makeMockRes();

    await getLeaveApplications(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.leaveApplication.findMany).not.toHaveBeenCalled();
  });

  it("allows ?staffId=<colleague> when the colleague is in the SAME branch", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ branchId: "branch-1", userId: "colleague-user" });
    (prisma.leaveApplication.findMany as jest.Mock).mockResolvedValue([{ id: "leave-1" }]);
    const req = makeReq({ query: { staffId: "staff-colleague" } });
    const res = makeMockRes();

    await getLeaveApplications(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("allows a staff member to query their OWN leave applications by staffId", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ branchId: "branch-OTHER", userId: "teacher-1" });
    (prisma.leaveApplication.findMany as jest.Mock).mockResolvedValue([]);
    const req = makeReq({ query: { staffId: "staff-self" } });
    const res = makeMockRes();

    await getLeaveApplications(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("still works with no staffId at all (admin browsing their own branch's applications)", async () => {
    (prisma.leaveApplication.findMany as jest.Mock).mockResolvedValue([]);
    const req = makeReq({
      query: {},
      user: { userId: "admin-1", email: "a@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" },
    });
    const res = makeMockRes();

    await getLeaveApplications(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.staff.findUnique).not.toHaveBeenCalled();
  });
});

describe("leave.controller - getLeaveBalance (IDOR fix)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.leaveType.findMany as jest.Mock).mockResolvedValue([{ id: "lt-1", name: "Casual Leave", code: "CL", maxDays: 12 }]);
    (prisma.leaveApplication.aggregate as jest.Mock).mockResolvedValue({ _sum: { days: 2 } });
  });

  it("SECURITY: rejects a real staffId belonging to a DIFFERENT branch", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ branchId: "branch-OTHER", userId: "victim-user" });
    const req = makeReq({ params: { staffId: "staff-victim" } });
    const res = makeMockRes();

    await getLeaveBalance(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.leaveType.findMany).not.toHaveBeenCalled();
  });

  it("allows a colleague in the SAME branch", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ branchId: "branch-1", userId: "colleague-user" });
    const req = makeReq({ params: { staffId: "staff-colleague" } });
    const res = makeMockRes();

    await getLeaveBalance(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("still resolves 'self' to the caller's own Staff record and succeeds", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValueOnce({ id: "staff-self", userId: "teacher-1" }); // findUnique({ where: { userId } })
    (prisma.staff.findUnique as jest.Mock).mockResolvedValueOnce({ branchId: "branch-1", userId: "teacher-1" }); // canAccessStaffRecord lookup
    const req = makeReq({ params: { staffId: "self" } });
    const res = makeMockRes();

    await getLeaveBalance(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });
});
