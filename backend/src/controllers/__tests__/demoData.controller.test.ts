import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    branch: { findUnique: jest.fn() },
  },
}));

jest.mock("../../services/demoData.service", () => ({
  generateDemoDataForBranch: jest.fn(),
  seedDemoData: jest.fn(),
  removeDemoData: jest.fn(),
  getDemoDataStatus: jest.fn(),
  DEMO_BRANCH_ID: "branch-main",
}));

jest.mock("../../services/auditLog.service", () => ({
  logAuditFromRequest: jest.fn(),
}));

import prisma from "../../config/database";
import { generateDemoData, getStatus, seed, remove } from "../demoData.controller";
import { generateDemoDataForBranch, seedDemoData, removeDemoData, getDemoDataStatus } from "../../services/demoData.service";
import { logAuditFromRequest } from "../../services/auditLog.service";
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
    user: { userId: "admin-1", email: "admin@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" },
    ...overrides,
  } as any);

const SAMPLE_RESULT = {
  studentsCreated: 45, parentsCreated: 90, staffCreated: 20,
  feeStructuresCreated: 15, feeAssignmentsCreated: 45, paymentsCreated: 31,
  attendanceRecordsCreated: 1300, examsCreated: 15, marksCreated: 180,
  homeworkCreated: 10, noticesCreated: 5,
  transportRoutesCreated: 3, transportAllocationsCreated: 14,
  libraryBooksCreated: 8, libraryIssuesCreated: 9,
};

describe("demoData.controller - generateDemoData", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.branch.findUnique as jest.Mock).mockResolvedValue({ id: "branch-1", name: "Main Campus" });
    (generateDemoDataForBranch as jest.Mock).mockResolvedValue(SAMPLE_RESULT);
  });

  it("BUG FIX: resolves to the caller's own branch when the client sends an empty branchId (Branch Admin)", async () => {
    const req = makeReq({ body: { branchId: "" } });
    const res = makeMockRes();

    await generateDemoData(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(generateDemoDataForBranch).toHaveBeenCalledWith("branch-1", "admin-1", expect.anything());
  });

  it("returns 400 when no branchId can be resolved", async () => {
    const req = makeReq({ user: { userId: "acct-1", email: "e", role: UserRole.ACCOUNTANT, branchId: undefined } });
    const res = makeMockRes();

    await generateDemoData(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(generateDemoDataForBranch).not.toHaveBeenCalled();
  });

  it("SECURITY: silently neutralizes a Branch Admin trying to target a different branch (generates for their own branch instead)", async () => {
    const req = makeReq({ body: { branchId: "branch-OTHER" } });
    const res = makeMockRes();

    await generateDemoData(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(generateDemoDataForBranch).toHaveBeenCalledWith("branch-1", "admin-1", expect.anything());
  });

  it("SUPER_ADMIN can explicitly target a different branch by sending its branchId", async () => {
    const req = makeReq({
      body: { branchId: "branch-2" },
      user: { userId: "super-1", email: "e", role: UserRole.SUPER_ADMIN, branchId: "branch-1" },
    });
    const res = makeMockRes();

    await generateDemoData(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(generateDemoDataForBranch).toHaveBeenCalledWith("branch-2", "super-1", expect.anything());
  });

  it("returns 404 when the resolved branch does not exist", async () => {
    (prisma.branch.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq();
    const res = makeMockRes();

    await generateDemoData(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(generateDemoDataForBranch).not.toHaveBeenCalled();
  });

  it("passes through numeric options exactly as sent", async () => {
    const req = makeReq({ body: { studentsPerSection: 25, staffCount: 30, attendanceDays: 10 } });
    const res = makeMockRes();

    await generateDemoData(req, res);

    expect(generateDemoDataForBranch).toHaveBeenCalledWith(
      "branch-1",
      "admin-1",
      expect.objectContaining({ studentsPerSection: 25, staffCount: 30, attendanceDays: 10 })
    );
  });

  // BUG FIX GUARD: Number("") is NaN, which must never reach the
  // service's Math.min/Math.max clamps (NaN propagates through both
  // silently) - a blank numeric field must behave as "use the
  // service's own default", not "generate a NaN count".
  it("BUG FIX: normalizes a non-finite numeric option (e.g. from a blank form field) to undefined instead of NaN", async () => {
    const req = makeReq({ body: { studentsPerSection: NaN, staffCount: Infinity } });
    const res = makeMockRes();

    await generateDemoData(req, res);

    const optionsArg = (generateDemoDataForBranch as jest.Mock).mock.calls[0][2];
    expect(optionsArg.studentsPerSection).toBeUndefined();
    expect(optionsArg.staffCount).toBeUndefined();
  });

  it("returns the full result summary from the service on success", async () => {
    const req = makeReq();
    const res = makeMockRes();

    await generateDemoData(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: SAMPLE_RESULT })
    );
  });

  it("returns 500 when the service throws (e.g. no academic year configured)", async () => {
    (generateDemoDataForBranch as jest.Mock).mockRejectedValue(new Error("No academic year found for this branch - create one first"));
    const req = makeReq();
    const res = makeMockRes();

    await generateDemoData(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});

const makeSuperAdminReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
  ({
    body: {},
    params: {},
    query: {},
    user: { userId: "super-1", email: "superadmin@abcschool.edu.in", role: UserRole.SUPER_ADMIN },
    ...overrides,
  } as any);

describe("demoData.controller - getStatus", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the status from the service as-is", async () => {
    const status = { seeded: true, branchId: "branch-main", counts: {}, canRemove: true, blockedReasons: [] };
    (getDemoDataStatus as jest.Mock).mockResolvedValue(status);

    const req = makeSuperAdminReq();
    const res = makeMockRes();

    await getStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: status }));
  });

  it("returns 500 when the service throws", async () => {
    (getDemoDataStatus as jest.Mock).mockRejectedValue(new Error("db down"));

    const req = makeSuperAdminReq();
    const res = makeMockRes();

    await getStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("demoData.controller - seed (structural)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("seeds demo data and writes an audit log entry", async () => {
    const summary = { organization: "ABC Public School Group", branch: "ABC Public School - Main Campus" };
    (seedDemoData as jest.Mock).mockResolvedValue(summary);

    const req = makeSuperAdminReq();
    const res = makeMockRes();

    await seed(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: summary }));
    expect(logAuditFromRequest).toHaveBeenCalledWith(req, "CREATE", "demoData", "branch-main", { newData: summary });
  });

  it("returns 500 when seeding fails", async () => {
    (seedDemoData as jest.Mock).mockRejectedValue(new Error("unique constraint"));

    const req = makeSuperAdminReq();
    const res = makeMockRes();

    await seed(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(logAuditFromRequest).not.toHaveBeenCalled();
  });
});

describe("demoData.controller - remove (structural)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("removes demo data and writes an audit log entry on success", async () => {
    (removeDemoData as jest.Mock).mockResolvedValue({ removed: true, message: "Demo data removed successfully." });

    const req = makeSuperAdminReq();
    const res = makeMockRes();

    await remove(req, res);

    expect(removeDemoData).toHaveBeenCalledWith("super-1");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(logAuditFromRequest).toHaveBeenCalled();
  });

  it("returns 400 with blockedReasons when removal is blocked, and does NOT log an audit entry", async () => {
    (removeDemoData as jest.Mock).mockResolvedValue({
      removed: false,
      message: "Cannot remove demo data - real records exist on top of it.",
      blockedReasons: ["3 student(s)"],
    });

    const req = makeSuperAdminReq();
    const res = makeMockRes();

    await remove(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: JSON.stringify(["3 student(s)"]) })
    );
    expect(logAuditFromRequest).not.toHaveBeenCalled();
  });

  it("returns 500 when the service throws", async () => {
    (removeDemoData as jest.Mock).mockRejectedValue(new Error("unexpected"));

    const req = makeSuperAdminReq();
    const res = makeMockRes();

    await remove(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
