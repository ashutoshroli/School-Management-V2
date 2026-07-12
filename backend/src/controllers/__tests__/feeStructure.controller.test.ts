import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    feeStructure: { findUnique: jest.fn(), create: jest.fn() },
    feeInstallment: { createMany: jest.fn() },
    feeAssignment: { count: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { createFeeStructure, getFeeStructureById } from "../feeStructure.controller";
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

  it("SECURITY: silently neutralizes a Branch Admin trying to target a different branch (creates under their own branch instead)", async () => {
    (prisma.feeStructure.findUnique as jest.Mock).mockReset();
    (prisma.feeStructure.findUnique as jest.Mock).mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "structure-1",
      feeCategory: {},
      class: {},
      installments: [],
    });
    (prisma.feeStructure.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "structure-1", ...data }));

    const req = makeReq({ body: { ...baseBody, branchId: "branch-OTHER" } });
    const res = makeMockRes();

    await createFeeStructure(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect((prisma.feeStructure.create as jest.Mock).mock.calls[0][0].data.branchId).toBe("branch-1");
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

  // BUG FIX / REGRESSION: FeeStructure.classId became nullable in the
  // schema (to allow transport-route-wise structures, classId null +
  // transportRouteId set - see assignTransportFee in
  // feeCollection.controller.ts) - this form only ever creates
  // class-wise structures, so it must keep requiring classId rather
  // than silently creating a structure with neither classId nor
  // transportRouteId set (which nothing else in the app can look up).
  it("rejects when classId is missing (this endpoint never creates transport-route-wise structures)", async () => {
    const req = makeReq({ body: { ...baseBody, classId: undefined } });
    const res = makeMockRes();

    await createFeeStructure(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.feeStructure.findUnique).not.toHaveBeenCalled();
    expect(prisma.feeStructure.create).not.toHaveBeenCalled();
  });
});

describe("feeStructure.controller - getFeeStructureById", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 404 when the structure does not exist", async () => {
    (prisma.feeStructure.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { id: "structure-1" } });
    const res = makeMockRes();

    await getFeeStructureById(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects a structure belonging to a DIFFERENT branch", async () => {
    (prisma.feeStructure.findUnique as jest.Mock).mockResolvedValue({ id: "structure-1", branchId: "branch-OTHER" });
    const req = makeReq({ params: { id: "structure-1" } });
    const res = makeMockRes();

    await getFeeStructureById(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.feeAssignment.count).not.toHaveBeenCalled();
  });

  it("returns the structure with its assigned-student count", async () => {
    (prisma.feeStructure.findUnique as jest.Mock).mockResolvedValue({ id: "structure-1", branchId: "branch-1", installments: [] });
    (prisma.feeAssignment.count as jest.Mock).mockResolvedValue(42);
    const req = makeReq({ params: { id: "structure-1" } });
    const res = makeMockRes();

    await getFeeStructureById(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(payload.assignedStudentCount).toBe(42);
  });
});
