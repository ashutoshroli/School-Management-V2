import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    feeCategory: { findUnique: jest.fn(), create: jest.fn() },
    feeStructure: { count: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { createFeeCategory, getFeeCategoryById } from "../feeCategory.controller";
import { AuthRequest } from "../../types";

const makeMockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const makeReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
  ({
    body: { name: "Activity Fee", code: "ACTIVITY" },
    params: {},
    query: {},
    user: { userId: "admin-1", email: "admin@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" },
    ...overrides,
  } as any);

describe("feeCategory.controller - createFeeCategory", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.feeCategory.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.feeCategory.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "cat-1", ...data }));
  });

  it("BUG FIX: falls back to the caller's own branch when the client sends an empty branchId", async () => {
    const req = makeReq({ body: { branchId: "", name: "Activity Fee", code: "ACTIVITY" } });
    const res = makeMockRes();

    await createFeeCategory(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect((prisma.feeCategory.create as jest.Mock).mock.calls[0][0].data.branchId).toBe("branch-1");
  });

  it("returns 400 when no branchId can be resolved", async () => {
    const req = makeReq({
      body: { branchId: "", name: "Activity Fee", code: "ACTIVITY" },
      user: { userId: "u1", email: "e", role: UserRole.ACCOUNTANT, branchId: undefined },
    });
    const res = makeMockRes();

    await createFeeCategory(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.feeCategory.create).not.toHaveBeenCalled();
  });

  it("SECURITY: silently neutralizes a Branch Admin trying to target a different branch (creates under their own branch instead)", async () => {
    const req = makeReq({ body: { branchId: "branch-OTHER", name: "Activity Fee", code: "ACTIVITY" } });
    const res = makeMockRes();

    await createFeeCategory(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect((prisma.feeCategory.create as jest.Mock).mock.calls[0][0].data.branchId).toBe("branch-1");
  });

  it("rejects a duplicate category code within the same branch", async () => {
    (prisma.feeCategory.findUnique as jest.Mock).mockResolvedValue({ id: "existing" });

    const req = makeReq({ body: { branchId: "", name: "Activity Fee", code: "ACTIVITY" } });
    const res = makeMockRes();

    await createFeeCategory(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.feeCategory.create).not.toHaveBeenCalled();
  });
});

describe("feeCategory.controller - getFeeCategoryById", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 404 when the category does not exist", async () => {
    (prisma.feeCategory.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { id: "cat-1" } });
    const res = makeMockRes();

    await getFeeCategoryById(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects a category belonging to a DIFFERENT branch", async () => {
    (prisma.feeCategory.findUnique as jest.Mock).mockResolvedValue({ id: "cat-1", branchId: "branch-OTHER" });
    const req = makeReq({ params: { id: "cat-1" } });
    const res = makeMockRes();

    await getFeeCategoryById(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns the category with its structure count", async () => {
    (prisma.feeCategory.findUnique as jest.Mock).mockResolvedValue({ id: "cat-1", branchId: "branch-1", name: "Tuition Fee" });
    (prisma.feeStructure.count as jest.Mock).mockResolvedValue(3);
    const req = makeReq({ params: { id: "cat-1" } });
    const res = makeMockRes();

    await getFeeCategoryById(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(payload.structureCount).toBe(3);
  });
});
