import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    studentDiscount: { create: jest.fn(), createMany: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
    student: { findUnique: jest.fn(), findMany: jest.fn() },
    feeAssignment: { findUnique: jest.fn(), findMany: jest.fn() },
    feeStructure: { findUnique: jest.fn() },
  },
}));

jest.mock("../../services/feePayment.service", () => ({
  recalculateFeeAssignmentDiscount: jest.fn(),
}));

import prisma from "../../config/database";
import { recalculateFeeAssignmentDiscount } from "../../services/feePayment.service";
import { assignDiscount, bulkAssignDiscount, getAllDiscounts, getDiscountById, toggleDiscount, deleteDiscount } from "../discount.controller";
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
    const req = makeReq({ body: { studentId: "s1", feeAssignmentId: "fa-1", type: "SIBLING", name: "Sibling Discount", value: 10, isPercent: true } });
    const res = makeMockRes();

    await assignDiscount(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.studentDiscount.create).not.toHaveBeenCalled();
  });

  it("SECURITY: rejects assigning a discount to a student in a DIFFERENT branch", async () => {
    (prisma.student.findUnique as jest.Mock).mockResolvedValue({ branchId: "branch-OTHER" });
    const req = makeReq({ body: { studentId: "s1", feeAssignmentId: "fa-1", type: "SIBLING", name: "x", value: 10 } });
    const res = makeMockRes();

    await assignDiscount(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.studentDiscount.create).not.toHaveBeenCalled();
  });

  it("returns 400 when feeAssignmentId is missing (BUG FIX regression guard)", async () => {
    const req = makeReq({ body: { studentId: "s1", type: "SIBLING", name: "x", value: 10 } });
    const res = makeMockRes();

    await assignDiscount(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.studentDiscount.create).not.toHaveBeenCalled();
  });

  it("SECURITY: rejects a feeAssignmentId that belongs to a DIFFERENT student", async () => {
    (prisma.student.findUnique as jest.Mock).mockResolvedValue({ branchId: "branch-1" });
    (prisma.feeAssignment.findUnique as jest.Mock).mockResolvedValue({ studentId: "someone-else" });
    const req = makeReq({ body: { studentId: "s1", feeAssignmentId: "fa-1", type: "SIBLING", name: "x", value: 10 } });
    const res = makeMockRes();

    await assignDiscount(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.studentDiscount.create).not.toHaveBeenCalled();
  });

  it("creates the discount linked to the given feeAssignmentId and recalculates it (BUG FIX: this is what actually reduces the pending amount)", async () => {
    (prisma.student.findUnique as jest.Mock).mockResolvedValue({ branchId: "branch-1" });
    (prisma.feeAssignment.findUnique as jest.Mock).mockResolvedValue({ studentId: "s1" });
    (prisma.studentDiscount.create as jest.Mock).mockResolvedValue({ id: "d1" });
    const req = makeReq({ body: { studentId: "s1", feeAssignmentId: "fa-1", type: "SIBLING", name: "Sibling Discount", value: 10, isPercent: true } });
    const res = makeMockRes();

    await assignDiscount(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(prisma.studentDiscount.create).toHaveBeenCalledWith({
      data: { studentId: "s1", feeAssignmentId: "fa-1", type: "SIBLING", name: "Sibling Discount", value: 10, isPercent: true, isActive: true },
    });
    expect(recalculateFeeAssignmentDiscount).toHaveBeenCalledWith(prisma, "fa-1");
  });
});

// Backend UX Gap Phase 4: assignDiscount was solo-only; bulkAssignDiscount
// now covers "give this scholarship to all Class 10 students" in one call.
// BUG FIX (this phase): feeStructureId is now required, and each matched
// student's OWN FeeAssignment for that structure is looked up and linked
// individually - without this, bulk discounts (like single ones) never
// reduced anything a student owed.
describe("discount.controller - bulkAssignDiscount", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.feeStructure.findUnique as jest.Mock).mockResolvedValue({ branchId: "branch-1" });
  });

  it("returns 400 when feeStructureId is missing", async () => {
    const req = makeReq({ body: { classId: "class-1", type: "MERIT_SCHOLARSHIP", name: "x", value: 20 } });
    const res = makeMockRes();

    await bulkAssignDiscount(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.studentDiscount.createMany).not.toHaveBeenCalled();
  });

  it("returns 404 when the fee structure does not belong to the caller's branch", async () => {
    (prisma.feeStructure.findUnique as jest.Mock).mockResolvedValue({ branchId: "branch-OTHER" });
    const req = makeReq({ body: { classId: "class-1", feeStructureId: "fs-1", type: "MERIT_SCHOLARSHIP", name: "x", value: 20 } });
    const res = makeMockRes();

    await bulkAssignDiscount(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("links each matched student's OWN fee assignment for the given structure, skipping students with no assignment for it", async () => {
    (prisma.student.findMany as jest.Mock).mockResolvedValue([{ id: "s1" }, { id: "s2" }]);
    // Only s1 has an assignment for this fee structure - s2 should be skipped.
    (prisma.feeAssignment.findMany as jest.Mock).mockResolvedValue([{ id: "fa-1", studentId: "s1" }]);
    (prisma.studentDiscount.createMany as jest.Mock).mockResolvedValue({ count: 1 });
    const req = makeReq({ body: { classId: "class-1", feeStructureId: "fs-1", type: "MERIT_SCHOLARSHIP", name: "Merit Scholarship", value: 20, isPercent: true } });
    const res = makeMockRes();

    await bulkAssignDiscount(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(prisma.student.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { branchId: "branch-1", isActive: true, classId: "class-1" } })
    );
    expect(prisma.studentDiscount.createMany).toHaveBeenCalledWith({
      data: [{ studentId: "s1", feeAssignmentId: "fa-1", type: "MERIT_SCHOLARSHIP", name: "Merit Scholarship", value: 20, isPercent: true, isActive: true }],
    });
    expect(recalculateFeeAssignmentDiscount).toHaveBeenCalledWith(prisma, "fa-1");
  });

  it("returns 0 assigned with no error when no students match", async () => {
    (prisma.student.findMany as jest.Mock).mockResolvedValue([]);
    const req = makeReq({ body: { classId: "class-1", feeStructureId: "fs-1", type: "MERIT_SCHOLARSHIP", name: "x", value: 20 } });
    const res = makeMockRes();

    await bulkAssignDiscount(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.studentDiscount.createMany).not.toHaveBeenCalled();
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

  // Backend UX Gap Phase 3: no classId/sectionId filter existed before.
  it("narrows by classId when provided", async () => {
    (prisma.studentDiscount.findMany as jest.Mock).mockResolvedValue([]);
    const req = makeReq({ query: { classId: "class-1" } });
    const res = makeMockRes();

    await getAllDiscounts(req, res);

    expect(prisma.studentDiscount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { student: { branchId: "branch-1", classId: "class-1" }, isActive: true } })
    );
  });

  it("narrows by sectionId when provided", async () => {
    (prisma.studentDiscount.findMany as jest.Mock).mockResolvedValue([]);
    const req = makeReq({ query: { sectionId: "sec-1" } });
    const res = makeMockRes();

    await getAllDiscounts(req, res);

    expect(prisma.studentDiscount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { student: { branchId: "branch-1", sectionId: "sec-1" }, isActive: true } })
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

describe("discount.controller - toggleDiscount / deleteDiscount (branch-access + recalculation)", () => {
  const DISCOUNT = { id: "d1", isActive: true, feeAssignmentId: "fa-1", student: { branchId: "branch-1" } };

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

  it("BUG FIX: toggleDiscount flips isActive AND recalculates the linked FeeAssignment.discount", async () => {
    (prisma.studentDiscount.findUnique as jest.Mock).mockResolvedValue(DISCOUNT);
    (prisma.studentDiscount.update as jest.Mock).mockResolvedValue({ ...DISCOUNT, isActive: false });
    const req = makeReq({ params: { id: "d1" } });
    const res = makeMockRes();

    await toggleDiscount(req, res);

    expect(prisma.studentDiscount.update).toHaveBeenCalledWith({ where: { id: "d1" }, data: { isActive: false } });
    expect(recalculateFeeAssignmentDiscount).toHaveBeenCalledWith(prisma, "fa-1");
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("toggleDiscount does not attempt to recalculate when the discount has no linked feeAssignmentId (legacy row)", async () => {
    (prisma.studentDiscount.findUnique as jest.Mock).mockResolvedValue({ ...DISCOUNT, feeAssignmentId: null });
    (prisma.studentDiscount.update as jest.Mock).mockResolvedValue({ ...DISCOUNT, feeAssignmentId: null, isActive: false });
    const req = makeReq({ params: { id: "d1" } });
    const res = makeMockRes();

    await toggleDiscount(req, res);

    expect(recalculateFeeAssignmentDiscount).not.toHaveBeenCalled();
  });

  it("SECURITY: deleteDiscount rejects a discount belonging to a student in a DIFFERENT branch", async () => {
    (prisma.studentDiscount.findUnique as jest.Mock).mockResolvedValue({ ...DISCOUNT, student: { branchId: "branch-OTHER" } });
    const req = makeReq({ params: { id: "d1" } });
    const res = makeMockRes();

    await deleteDiscount(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.studentDiscount.delete).not.toHaveBeenCalled();
  });

  it("BUG FIX: deleteDiscount removes the discount AND recalculates the linked FeeAssignment.discount", async () => {
    (prisma.studentDiscount.findUnique as jest.Mock).mockResolvedValue(DISCOUNT);
    (prisma.studentDiscount.delete as jest.Mock).mockResolvedValue({});
    const req = makeReq({ params: { id: "d1" } });
    const res = makeMockRes();

    await deleteDiscount(req, res);

    expect(prisma.studentDiscount.delete).toHaveBeenCalledWith({ where: { id: "d1" } });
    expect(recalculateFeeAssignmentDiscount).toHaveBeenCalledWith(prisma, "fa-1");
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
