import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    feeStructure: { findUnique: jest.fn(), create: jest.fn() },
    feeInstallment: { createMany: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { createFeeStructure } from "../feeStructure.controller";
import { AuthRequest } from "../../types";

const makeMockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const baseBody = {
  academicYearId: "ay-1",
  classId: "class-1",
  feeCategoryId: "cat-1",
  amount: 5000,
  frequency: "MONTHLY",
};

const makeReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
  ({
    body: { ...baseBody },
    params: {},
    query: {},
    user: { userId: "admin-1", email: "admin@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" },
    ...overrides,
  } as any);

describe("feeStructure.controller - createFeeStructure", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.feeStructure.findUnique as jest.Mock).mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "structure-1",
      feeCategory: {},
      class: {},
      installments: [],
    });
    (prisma.feeStructure.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "structure-1", ...data }));
  });

  it("BUG FIX: falls back to the caller's own branch when the client sends an empty branchId", async () => {
    const req = makeReq({ body: { ...baseBody, branchId: "" } });
    const res = makeMockRes();

    await createFeeStructure(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect((prisma.feeStructure.create as jest.Mock).mock.calls[0][0].data.branchId).toBe("branch-1");
  });

  it("returns 400 when no branchId can be resolved", async () => {
    const req = makeReq({
      body: { ...baseBody, branchId: "" },
      user: { userId: "u1", email: "e", role: UserRole.ACCOUNTANT, branchId: undefined },
    });
    const res = makeMockRes();

    await createFeeStructure(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.feeStructure.create).not.toHaveBeenCalled();
  });

  it("SECURITY: rejects a Branch Admin explicitly targeting a different branch", async () => {
    const req = makeReq({ body: { ...baseBody, branchId: "branch-OTHER" } });
    const res = makeMockRes();

    await createFeeStructure(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.feeStructure.create).not.toHaveBeenCalled();
  });

  it("rejects a duplicate structure for the same branch+year+class+category", async () => {
    (prisma.feeStructure.findUnique as jest.Mock).mockReset();
    (prisma.feeStructure.findUnique as jest.Mock).mockResolvedValue({ id: "existing" });

    const req = makeReq({ body: { ...baseBody, branchId: "" } });
    const res = makeMockRes();

    await createFeeStructure(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.feeStructure.create).not.toHaveBeenCalled();
  });
});
