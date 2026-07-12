import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    staff: { findUnique: jest.fn() },
    leaveApplication: { findMany: jest.fn(), aggregate: jest.fn(), count: jest.fn() },
    leaveType: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { getLeaveApplications, getLeaveBalance, getLeaveTypes, getLeaveTypeById, createLeaveType, updateLeaveType, deleteLeaveType } from "../leave.controller";
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

  // Backend UX Gap Phase 3: no leaveTypeId filter or date range existed
  // before - only staffId/status.
  it("filters by leaveTypeId when provided", async () => {
    (prisma.leaveApplication.findMany as jest.Mock).mockResolvedValue([]);
    const req = makeReq({
      query: { leaveTypeId: "lt-1" },
      user: { userId: "admin-1", email: "a@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" },
    });
    const res = makeMockRes();

    await getLeaveApplications(req, res);

    const whereArg = (prisma.leaveApplication.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.leaveTypeId).toBe("lt-1");
  });

  it("filters by a fromDate/toDate range (applications overlapping the range)", async () => {
    (prisma.leaveApplication.findMany as jest.Mock).mockResolvedValue([]);
    const req = makeReq({
      query: { fromDate: "2024-06-01", toDate: "2024-06-30" },
      user: { userId: "admin-1", email: "a@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" },
    });
    const res = makeMockRes();

    await getLeaveApplications(req, res);

    const whereArg = (prisma.leaveApplication.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.toDate).toEqual({ gte: new Date("2024-06-01") });
    expect(whereArg.fromDate).toEqual({ lte: new Date("2024-06-30") });
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


describe("leave.controller - getLeaveTypes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.leaveType.findMany as jest.Mock).mockResolvedValue([]);
  });

  it("defaults to only active types (unchanged behavior for the leave-apply form)", async () => {
    const req = makeReq({ query: {} });
    const res = makeMockRes();

    await getLeaveTypes(req, res);

    expect(prisma.leaveType.findMany).toHaveBeenCalledWith({ where: { isActive: true }, orderBy: { name: "asc" } });
  });

  it("includes inactive types when includeInactive=true (admin management UI)", async () => {
    const req = makeReq({ query: { includeInactive: "true" } });
    const res = makeMockRes();

    await getLeaveTypes(req, res);

    expect(prisma.leaveType.findMany).toHaveBeenCalledWith({ where: {}, orderBy: { name: "asc" } });
  });
});

describe("leave.controller - getLeaveTypeById", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 404 when the leave type does not exist", async () => {
    (prisma.leaveType.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { id: "lt-1" } });
    const res = makeMockRes();

    await getLeaveTypeById(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns the leave type with its application count", async () => {
    (prisma.leaveType.findUnique as jest.Mock).mockResolvedValue({ id: "lt-1", name: "Casual Leave" });
    (prisma.leaveApplication.count as jest.Mock).mockResolvedValue(7);
    const req = makeReq({ params: { id: "lt-1" } });
    const res = makeMockRes();

    await getLeaveTypeById(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(payload.applicationCount).toBe(7);
  });
});

describe("leave.controller - createLeaveType", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.leaveType.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.leaveType.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "lt-new", ...data }));
  });

  it("creates a new leave type", async () => {
    const req = makeReq({ body: { name: "Sabbatical Leave", code: "SAB", maxDays: 30, carryForward: false } });
    const res = makeMockRes();

    await createLeaveType(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(prisma.leaveType.create).toHaveBeenCalled();
  });

  it("DATA INTEGRITY: rejects a duplicate code", async () => {
    (prisma.leaveType.findUnique as jest.Mock).mockResolvedValue({ id: "existing" });
    const req = makeReq({ body: { name: "Sabbatical Leave", code: "SAB", maxDays: 30 } });
    const res = makeMockRes();

    await createLeaveType(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.leaveType.create).not.toHaveBeenCalled();
  });
});

describe("leave.controller - updateLeaveType", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.leaveType.findUnique as jest.Mock).mockResolvedValue({ id: "lt-1", name: "Casual Leave", code: "CL", maxDays: 12, carryForward: false, isActive: true });
    (prisma.leaveType.update as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "lt-1", ...data }));
  });

  it("updates maxDays/carryForward/isActive", async () => {
    const req = makeReq({ params: { id: "lt-1" }, body: { maxDays: 15, isActive: false } });
    const res = makeMockRes();

    await updateLeaveType(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect((prisma.leaveType.update as jest.Mock).mock.calls[0][0].data).toEqual({ maxDays: 15, isActive: false });
  });

  it("returns 404 for a nonexistent leave type", async () => {
    (prisma.leaveType.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { id: "missing" }, body: { maxDays: 15 } });
    const res = makeMockRes();

    await updateLeaveType(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.leaveType.update).not.toHaveBeenCalled();
  });
});

describe("leave.controller - deleteLeaveType", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.leaveType.findUnique as jest.Mock).mockResolvedValue({ id: "lt-1" });
  });

  it("deletes a leave type with no applications against it", async () => {
    (prisma.leaveApplication.count as jest.Mock).mockResolvedValue(0);
    (prisma.leaveType.delete as jest.Mock).mockResolvedValue({});
    const req = makeReq({ params: { id: "lt-1" } });
    const res = makeMockRes();

    await deleteLeaveType(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.leaveType.delete).toHaveBeenCalledWith({ where: { id: "lt-1" } });
  });

  it("DATA INTEGRITY: blocks deletion when leave applications reference this type", async () => {
    (prisma.leaveApplication.count as jest.Mock).mockResolvedValue(3);
    const req = makeReq({ params: { id: "lt-1" } });
    const res = makeMockRes();

    await deleteLeaveType(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.leaveType.delete).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent leave type", async () => {
    (prisma.leaveType.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { id: "missing" } });
    const res = makeMockRes();

    await deleteLeaveType(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
