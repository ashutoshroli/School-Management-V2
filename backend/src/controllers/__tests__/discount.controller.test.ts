import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    studentDiscount: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
    student: { findUnique: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { assignDiscount, getAllDiscounts, getDiscountById, toggleDiscount, deleteDiscount } from "../discount.controller";
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

describe("discount.controller - assignDiscount", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 404 when the student does not exist", async () => {
    (prisma.student.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ body: { studentId: "s1", type: "SIBLING", name: "Sibling Discount", value: 10, isPercent: true } });
    const res = makeMockRes();

    await assignDiscount(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.studentDiscount.create).not.toHaveBeenCalled();
  });

  it("SECURITY: rejects assigning a discount to a student in a DIFFERENT branch", async () => {
    (prisma.student.findUnique as jest.Mock).mockResolvedValue({ branchId: "branch-OTHER" });
    const req = makeReq({ body: { studentId: "s1", type: "SIBLING", name: "x", value: 10 } });
    const res = makeMockRes();

    await assignDiscount(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.studentDiscount.create).not.toHaveBeenCalled();
  });

  it("creates the discount when the student is in the caller's own branch", async () => {
    (prisma.student.findUnique as jest.Mock).mockResolvedValue({ branchId: "branch-1" });
    (prisma.studentDiscount.create as jest.Mock).mockResolvedValue({ id: "d1" });
    const req = makeReq({ body: { studentId: "s1", type: "SIBLING", name: "Sibling Discount", value: 10, isPercent: true } });
    const res = makeMockRes();

    await assignDiscount(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(prisma.studentDiscount.create).toHaveBeenCalledWith({
      data: { studentId: "s1", type: "SIBLING", name: "Sibling Discount", value: 10, isPercent: true, isActive: true },
    });
  });
});

describe("discount.controller - getAllDiscounts (branch-wide list)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 400 when no branchId can be resolved", async () => {
    const req = makeReq({ user: { userId: "super-1", email: "e", role: UserRole.SUPER_ADMIN } as any });
    const res = makeMockRes();

    await getAllDiscounts(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.studentDiscount.findMany).not.toHaveBeenCalled();
  });

  it("defaults to only ACTIVE discounts, scoped to the caller's branch", async () => {
    (prisma.studentDiscount.findMany as jest.Mock).mockResolvedValue([]);
    const req = makeReq({ query: {} });
    const res = makeMockRes();

    await getAllDiscounts(req, res);

    expect(prisma.studentDiscount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { student: { branchId: "branch-1" }, isActive: true },
      })
    );
  });

  it("includes inactive discounts when includeInactive=true is passed", async () => {
    (prisma.studentDiscount.findMany as jest.Mock).mockResolvedValue([]);
    const req = makeReq({ query: { includeInactive: "true" } });
    const res = makeMockRes();

    await getAllDiscounts(req, res);

    expect(prisma.studentDiscount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { student: { branchId: "branch-1" } } })
    );
  });

  it("narrows by type when provided", async () => {
    (prisma.studentDiscount.findMany as jest.Mock).mockResolvedValue([]);
    const req = makeReq({ query: { type: "RTE" } });
    const res = makeMockRes();

    await getAllDiscounts(req, res);

    expect(prisma.studentDiscount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { student: { branchId: "branch-1" }, isActive: true, type: "RTE" } })
    );
  });
});

describe("discount.controller - getDiscountById", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 404 when the discount does not exist", async () => {
    (prisma.studentDiscount.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { id: "d1" } });
    const res = makeMockRes();

    await getDiscountById(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects a discount belonging to a student in a DIFFERENT branch", async () => {
    (prisma.studentDiscount.findUnique as jest.Mock).mockResolvedValue({ id: "d1", student: { branchId: "branch-OTHER" } });
    const req = makeReq({ params: { id: "d1" } });
    const res = makeMockRes();

    await getDiscountById(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns the discount when its student is in the caller's own branch", async () => {
    (prisma.studentDiscount.findUnique as jest.Mock).mockResolvedValue({
      id: "d1",
      name: "Sibling Discount",
      student: { branchId: "branch-1", user: { name: "Ravi" } },
    });
    const req = makeReq({ params: { id: "d1" } });
    const res = makeMockRes();

    await getDiscountById(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe("discount.controller - toggleDiscount / deleteDiscount (branch-access)", () => {
  const DISCOUNT = { id: "d1", isActive: true, student: { branchId: "branch-1" } };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("toggleDiscount returns 404 when the discount does not exist", async () => {
    (prisma.studentDiscount.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { id: "d1" } });
    const res = makeMockRes();

    await toggleDiscount(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: toggleDiscount rejects a discount belonging to a student in a DIFFERENT branch", async () => {
    (prisma.studentDiscount.findUnique as jest.Mock).mockResolvedValue({ ...DISCOUNT, student: { branchId: "branch-OTHER" } });
    const req = makeReq({ params: { id: "d1" } });
    const res = makeMockRes();

    await toggleDiscount(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.studentDiscount.update).not.toHaveBeenCalled();
  });

  it("toggleDiscount flips isActive within the caller's own branch", async () => {
    (prisma.studentDiscount.findUnique as jest.Mock).mockResolvedValue(DISCOUNT);
    (prisma.studentDiscount.update as jest.Mock).mockResolvedValue({ ...DISCOUNT, isActive: false });
    const req = makeReq({ params: { id: "d1" } });
    const res = makeMockRes();

    await toggleDiscount(req, res);

    expect(prisma.studentDiscount.update).toHaveBeenCalledWith({ where: { id: "d1" }, data: { isActive: false } });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("SECURITY: deleteDiscount rejects a discount belonging to a student in a DIFFERENT branch", async () => {
    (prisma.studentDiscount.findUnique as jest.Mock).mockResolvedValue({ ...DISCOUNT, student: { branchId: "branch-OTHER" } });
    const req = makeReq({ params: { id: "d1" } });
    const res = makeMockRes();

    await deleteDiscount(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.studentDiscount.delete).not.toHaveBeenCalled();
  });

  it("deleteDiscount removes the discount within the caller's own branch", async () => {
    (prisma.studentDiscount.findUnique as jest.Mock).mockResolvedValue(DISCOUNT);
    (prisma.studentDiscount.delete as jest.Mock).mockResolvedValue({});
    const req = makeReq({ params: { id: "d1" } });
    const res = makeMockRes();

    await deleteDiscount(req, res);

    expect(prisma.studentDiscount.delete).toHaveBeenCalledWith({ where: { id: "d1" } });
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
