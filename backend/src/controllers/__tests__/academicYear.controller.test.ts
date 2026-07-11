import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    academicYear: { findUnique: jest.fn(), create: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { createAcademicYear } from "../academicYear.controller";
import { AuthRequest } from "../../types";

const makeMockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const makeReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
  ({
    body: { name: "2025-26", startDate: "2025-04-01", endDate: "2026-03-31" },
    params: {},
    query: {},
    user: { userId: "admin-1", email: "admin@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" },
    ...overrides,
  } as any);

describe("academicYear.controller - createAcademicYear", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("BUG FIX: creates the academic year using the caller's own branch when the client sends an empty branchId (Branch Admin)", async () => {
    (prisma.academicYear.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.academicYear.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "ay-1", ...data }));

    const req = makeReq({ body: { branchId: "", name: "2025-26", startDate: "2025-04-01", endDate: "2026-03-31" } });
    const res = makeMockRes();

    await createAcademicYear(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const createCall = (prisma.academicYear.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data.branchId).toBe("branch-1");
  });

  it("BUG FIX: creates the academic year using the caller's own branch when branchId is omitted entirely (Super Admin)", async () => {
    (prisma.academicYear.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.academicYear.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "ay-1", ...data }));

    const req = makeReq({
      body: { name: "2025-26", startDate: "2025-04-01", endDate: "2026-03-31" },
      user: { userId: "super-1", email: "super@test.com", role: UserRole.SUPER_ADMIN, branchId: "branch-1" },
    });
    const res = makeMockRes();

    await createAcademicYear(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const createCall = (prisma.academicYear.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data.branchId).toBe("branch-1");
  });

  it("returns 400 with a clear message when the user has no resolvable branchId at all", async () => {
    const req = makeReq({
      body: { branchId: "", name: "2025-26", startDate: "2025-04-01", endDate: "2026-03-31" },
      user: { userId: "acct-1", email: "acct@test.com", role: UserRole.ACCOUNTANT, branchId: undefined },
    });
    const res = makeMockRes();

    await createAcademicYear(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.academicYear.create).not.toHaveBeenCalled();
  });

  it("SECURITY: still rejects a Branch Admin explicitly trying to target a different branch", async () => {
    const req = makeReq({ body: { branchId: "branch-OTHER", name: "2025-26", startDate: "2025-04-01", endDate: "2026-03-31" } });
    const res = makeMockRes();

    await createAcademicYear(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.academicYear.create).not.toHaveBeenCalled();
  });

  it("rejects a duplicate academic year name within the same branch", async () => {
    (prisma.academicYear.findUnique as jest.Mock).mockResolvedValue({ id: "existing", branchId: "branch-1", name: "2025-26" });

    const req = makeReq({ body: { branchId: "", name: "2025-26", startDate: "2025-04-01", endDate: "2026-03-31" } });
    const res = makeMockRes();

    await createAcademicYear(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.academicYear.create).not.toHaveBeenCalled();
  });
});
