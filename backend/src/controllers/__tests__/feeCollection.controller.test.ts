import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    feeAssignment: { findUnique: jest.fn(), findMany: jest.fn(), createMany: jest.fn() },
    feeStructure: { findUnique: jest.fn(), create: jest.fn() },
    feeCategory: { findUnique: jest.fn(), create: jest.fn() },
    transportRoute: { findUnique: jest.fn() },
    transportAllocation: { findMany: jest.fn(), createMany: jest.fn(), updateMany: jest.fn() },
    academicYear: { findUnique: jest.fn() },
    student: { findUnique: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock("../../services/feePayment.service", () => ({
  getValidatedFeeAssignment: jest.fn(),
  recordFeePayment: jest.fn(),
  notifyPaymentConfirmation: jest.fn(),
}));

jest.mock("../../services/auditLog.service", () => ({
  logAuditFromRequest: jest.fn(),
}));

import prisma from "../../config/database";
import { getValidatedFeeAssignment, recordFeePayment } from "../../services/feePayment.service";
import { collectPayment, assignFeesToStudents, assignTransportFee, assignTransportFeeToStudents } from "../feeCollection.controller";
import { AuthRequest } from "../../types";

const makeMockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const baseBody = {
  studentId: "student-1",
  feeAssignmentId: "fa-1",
  amount: "5000",
  paymentMode: "CASH",
};

const makeReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
  ({
    body: { ...baseBody },
    params: {},
    query: {},
    user: { userId: "admin-1", email: "admin@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" },
    ...overrides,
  } as any);

describe("feeCollection.controller - collectPayment", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getValidatedFeeAssignment as jest.Mock).mockResolvedValue({
      assignment: { id: "fa-1", totalAmount: 10000, paidAmount: 0, discount: 0, lateFee: 0 },
    });
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback: any) => callback({}));
    (recordFeePayment as jest.Mock).mockResolvedValue({
      payment: { id: "pay-1", receiptNo: "RCP-001" },
      lateFeeCharged: 0,
      newStatus: "PARTIAL",
    });
    (prisma.student.findUnique as jest.Mock).mockResolvedValue({ user: { name: "Ravi Kumar" } });
  });

  it("BUG FIX: falls back to the caller's own branch when the client sends an empty branchId", async () => {
    const req = makeReq({ body: { ...baseBody, branchId: "" } });
    const res = makeMockRes();

    await collectPayment(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(getValidatedFeeAssignment).toHaveBeenCalledWith("fa-1", "student-1", "branch-1");
  });

  it("returns 400 when no branchId can be resolved", async () => {
    const req = makeReq({
      body: { ...baseBody, branchId: "" },
      user: { userId: "u1", email: "e", role: UserRole.ACCOUNTANT, branchId: undefined },
    });
    const res = makeMockRes();

    await collectPayment(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(getValidatedFeeAssignment).not.toHaveBeenCalled();
  });

  it("SECURITY: silently neutralizes a Branch Admin trying to target a different branch (falls back to their own branch)", async () => {
    const req = makeReq({ body: { ...baseBody, branchId: "branch-OTHER" } });
    const res = makeMockRes();

    await collectPayment(req, res);

    // The malicious branchId is ignored - fee validation uses the caller's own branch
    expect(res.status).toHaveBeenCalledWith(201);
    expect(getValidatedFeeAssignment).toHaveBeenCalledWith("fa-1", "student-1", "branch-1");
  });

  it("rejects a non-positive amount", async () => {
    const req = makeReq({ body: { ...baseBody, branchId: "", amount: "0" } });
    const res = makeMockRes();

    await collectPayment(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(getValidatedFeeAssignment).not.toHaveBeenCalled();
  });
});

describe("feeCollection.controller - assignFeesToStudents", () => {
  const makeAssignReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
    ({
      body: { feeStructureId: "fs-1", studentIds: ["student-1", "student-2"] },
      params: {},
      query: {},
      user: { userId: "admin-1", email: "admin@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" },
      ...overrides,
    } as any);

  const STRUCTURE = { id: "fs-1", branchId: "branch-1", amount: 5000 };

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.feeStructure.findUnique as jest.Mock).mockResolvedValue(STRUCTURE);
    (prisma.student.findMany as jest.Mock).mockResolvedValue([
      { id: "student-1", branchId: "branch-1" },
      { id: "student-2", branchId: "branch-1" },
    ]);
    (prisma.feeAssignment.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.feeAssignment.createMany as jest.Mock).mockResolvedValue({ count: 2 });
  });

  it("returns 400 when studentIds is missing or empty", async () => {
    const req = makeAssignReq({ body: { feeStructureId: "fs-1", studentIds: [] } });
    const res = makeMockRes();

    await assignFeesToStudents(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.feeStructure.findUnique).not.toHaveBeenCalled();
  });

  it("returns 404 when the fee structure does not exist", async () => {
    (prisma.feeStructure.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeAssignReq();
    const res = makeMockRes();

    await assignFeesToStudents(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects assigning a fee structure from a different branch", async () => {
    (prisma.feeStructure.findUnique as jest.Mock).mockResolvedValue({ ...STRUCTURE, branchId: "branch-OTHER" });
    const req = makeAssignReq();
    const res = makeMockRes();

    await assignFeesToStudents(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.student.findMany).not.toHaveBeenCalled();
  });

  it("returns 404 when one or more studentIds don't exist", async () => {
    (prisma.student.findMany as jest.Mock).mockResolvedValue([{ id: "student-1", branchId: "branch-1" }]);
    const req = makeAssignReq();
    const res = makeMockRes();

    await assignFeesToStudents(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.feeAssignment.createMany).not.toHaveBeenCalled();
  });

  it("SECURITY: rejects when a student in the list belongs to a different branch than the fee structure", async () => {
    (prisma.student.findMany as jest.Mock).mockResolvedValue([
      { id: "student-1", branchId: "branch-1" },
      { id: "student-2", branchId: "branch-OTHER" },
    ]);
    const req = makeAssignReq();
    const res = makeMockRes();

    await assignFeesToStudents(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.feeAssignment.createMany).not.toHaveBeenCalled();
  });

  it("creates fee assignments for every requested student when none already have one", async () => {
    const req = makeAssignReq();
    const res = makeMockRes();

    await assignFeesToStudents(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.feeAssignment.createMany).toHaveBeenCalledWith({
      data: [
        { studentId: "student-1", feeStructureId: "fs-1", totalAmount: 5000, paidAmount: 0, discount: 0, lateFee: 0, status: "PENDING" },
        { studentId: "student-2", feeStructureId: "fs-1", totalAmount: 5000, paidAmount: 0, discount: 0, lateFee: 0, status: "PENDING" },
      ],
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: { created: 2, skipped: 0, total: 2 } })
    );
  });

  it("skips students who already have this fee structure assigned (no N+1 - one findMany, not one findUnique per student)", async () => {
    (prisma.feeAssignment.findMany as jest.Mock).mockResolvedValue([{ studentId: "student-1" }]);
    const req = makeAssignReq();
    const res = makeMockRes();

    await assignFeesToStudents(req, res);

    expect(prisma.feeAssignment.createMany).toHaveBeenCalledWith({
      data: [{ studentId: "student-2", feeStructureId: "fs-1", totalAmount: 5000, paidAmount: 0, discount: 0, lateFee: 0, status: "PENDING" }],
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: { created: 1, skipped: 1, total: 2 } })
    );
  });

  it("does not call createMany at all when every student is already assigned", async () => {
    (prisma.feeAssignment.findMany as jest.Mock).mockResolvedValue([{ studentId: "student-1" }, { studentId: "student-2" }]);
    const req = makeAssignReq();
    const res = makeMockRes();

    await assignFeesToStudents(req, res);

    expect(prisma.feeAssignment.createMany).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: { created: 0, skipped: 2, total: 2 } })
    );
  });
});

describe("feeCollection.controller - assignTransportFee", () => {
  const makeTransportReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
    ({
      body: { routeId: "route-1", academicYearId: "ay-1" },
      params: {},
      query: {},
      user: { userId: "admin-1", email: "admin@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" },
      ...overrides,
    } as any);

  const ROUTE = { id: "route-1", branchId: "branch-1", monthlyFee: 1500 };
  const ACADEMIC_YEAR = { id: "ay-1", branchId: "branch-1" };
  const TRANSPORT_CATEGORY = { id: "cat-transport", branchId: "branch-1", code: "TRANSPORT" };
  const STRUCTURE = { id: "fs-transport-1", branchId: "branch-1", transportRouteId: "route-1", amount: 1500 };

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.transportRoute.findUnique as jest.Mock).mockResolvedValue(ROUTE);
    (prisma.academicYear.findUnique as jest.Mock).mockResolvedValue(ACADEMIC_YEAR);
    (prisma.feeCategory.findUnique as jest.Mock).mockResolvedValue(TRANSPORT_CATEGORY);
    (prisma.feeStructure.findUnique as jest.Mock).mockResolvedValue(STRUCTURE);
    (prisma.transportAllocation.findMany as jest.Mock).mockResolvedValue([
      { studentId: "student-1" },
      { studentId: "student-2" },
    ]);
    (prisma.feeAssignment.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.feeAssignment.createMany as jest.Mock).mockResolvedValue({ count: 2 });
  });

  it("returns 400 when routeId is missing", async () => {
    const req = makeTransportReq({ body: { academicYearId: "ay-1" } });
    const res = makeMockRes();

    await assignTransportFee(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.transportRoute.findUnique).not.toHaveBeenCalled();
  });

  it("returns 400 when academicYearId is missing", async () => {
    const req = makeTransportReq({ body: { routeId: "route-1" } });
    const res = makeMockRes();

    await assignTransportFee(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 404 when the route does not exist", async () => {
    (prisma.transportRoute.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeTransportReq();
    const res = makeMockRes();

    await assignTransportFee(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects a route from a different branch", async () => {
    (prisma.transportRoute.findUnique as jest.Mock).mockResolvedValue({ ...ROUTE, branchId: "branch-OTHER" });
    const req = makeTransportReq();
    const res = makeMockRes();

    await assignTransportFee(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.academicYear.findUnique).not.toHaveBeenCalled();
  });

  it("rejects an academic year that doesn't belong to the route's branch", async () => {
    (prisma.academicYear.findUnique as jest.Mock).mockResolvedValue({ id: "ay-1", branchId: "branch-OTHER" });
    const req = makeTransportReq();
    const res = makeMockRes();

    await assignTransportFee(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.feeCategory.findUnique).not.toHaveBeenCalled();
  });

  // BUG FIX: a branch created through the app has no fee categories at
  // all until an admin creates them (only db/prisma/seed.ts's demo
  // data pre-seeds "Transport Fee") - this must not assume the
  // category already exists.
  it("auto-creates the Transport Fee category when the branch doesn't have one yet", async () => {
    (prisma.feeCategory.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.feeCategory.create as jest.Mock).mockResolvedValue(TRANSPORT_CATEGORY);
    const req = makeTransportReq();
    const res = makeMockRes();

    await assignTransportFee(req, res);

    expect(prisma.feeCategory.create).toHaveBeenCalledWith({
      data: { branchId: "branch-1", name: "Transport Fee", code: "TRANSPORT", isSystem: true, isActive: true },
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // Mirrors the auto-create test above, but for the FeeStructure
  // itself - the first time a route's fee is ever assigned, no
  // structure exists yet for (branch, year, route, category).
  it("auto-creates the route's FeeStructure (keyed by branch+year+route+category) when none exists yet", async () => {
    (prisma.feeStructure.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.feeStructure.create as jest.Mock).mockResolvedValue(STRUCTURE);
    const req = makeTransportReq();
    const res = makeMockRes();

    await assignTransportFee(req, res);

    expect(prisma.feeStructure.create).toHaveBeenCalledWith({
      data: {
        branchId: "branch-1",
        academicYearId: "ay-1",
        transportRouteId: "route-1",
        feeCategoryId: "cat-transport",
        amount: 1500,
        frequency: "MONTHLY",
        dueDay: 10,
        lateFeeType: "NONE",
        lateFeeValue: 0,
        isActive: true,
      },
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("reuses an existing FeeStructure for the route instead of creating a duplicate", async () => {
    const req = makeTransportReq();
    const res = makeMockRes();

    await assignTransportFee(req, res);

    expect(prisma.feeStructure.create).not.toHaveBeenCalled();
    expect(prisma.feeAssignment.createMany).toHaveBeenCalledWith({
      data: [
        { studentId: "student-1", feeStructureId: "fs-transport-1", totalAmount: 1500, paidAmount: 0, discount: 0, lateFee: 0, status: "PENDING" },
        { studentId: "student-2", feeStructureId: "fs-transport-1", totalAmount: 1500, paidAmount: 0, discount: 0, lateFee: 0, status: "PENDING" },
      ],
    });
  });

  it("returns success with zero counts (no createMany call) when no students are allocated to the route", async () => {
    (prisma.transportAllocation.findMany as jest.Mock).mockResolvedValue([]);
    const req = makeTransportReq();
    const res = makeMockRes();

    await assignTransportFee(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.feeAssignment.createMany).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: { created: 0, skipped: 0, total: 0 } }));
  });

  it("skips students already assigned this route's fee (no N+1 - one findMany, not one findUnique per student)", async () => {
    (prisma.feeAssignment.findMany as jest.Mock).mockResolvedValue([{ studentId: "student-1" }]);
    const req = makeTransportReq();
    const res = makeMockRes();

    await assignTransportFee(req, res);

    expect(prisma.feeAssignment.createMany).toHaveBeenCalledWith({
      data: [{ studentId: "student-2", feeStructureId: "fs-transport-1", totalAmount: 1500, paidAmount: 0, discount: 0, lateFee: 0, status: "PENDING" }],
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: { created: 1, skipped: 1, total: 2, feeStructureId: "fs-transport-1" } })
    );
  });

  it("does not call createMany at all when every allocated student is already assigned", async () => {
    (prisma.feeAssignment.findMany as jest.Mock).mockResolvedValue([{ studentId: "student-1" }, { studentId: "student-2" }]);
    const req = makeTransportReq();
    const res = makeMockRes();

    await assignTransportFee(req, res);

    expect(prisma.feeAssignment.createMany).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: { created: 0, skipped: 2, total: 2, feeStructureId: "fs-transport-1" } })
    );
  });
});

describe("feeCollection.controller - assignTransportFeeToStudents", () => {
  const makeReqStudents = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
    ({
      body: { routeId: "route-1", academicYearId: "ay-1", studentIds: ["student-1", "student-2"] },
      params: {},
      query: {},
      user: { userId: "admin-1", email: "admin@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" },
      ...overrides,
    } as any);

  const ROUTE = { id: "route-1", branchId: "branch-1", monthlyFee: 1500 };
  const ACADEMIC_YEAR = { id: "ay-1", branchId: "branch-1" };
  const TRANSPORT_CATEGORY = { id: "cat-transport", branchId: "branch-1", code: "TRANSPORT" };
  const STRUCTURE = { id: "fs-transport-1", branchId: "branch-1", transportRouteId: "route-1", amount: 1500 };

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.transportRoute.findUnique as jest.Mock).mockResolvedValue(ROUTE);
    (prisma.academicYear.findUnique as jest.Mock).mockResolvedValue(ACADEMIC_YEAR);
    (prisma.feeCategory.findUnique as jest.Mock).mockResolvedValue(TRANSPORT_CATEGORY);
    (prisma.feeStructure.findUnique as jest.Mock).mockResolvedValue(STRUCTURE);
    (prisma.student.findMany as jest.Mock).mockResolvedValue([
      { id: "student-1", branchId: "branch-1" },
      { id: "student-2", branchId: "branch-1" },
    ]);
    (prisma.feeAssignment.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.feeAssignment.createMany as jest.Mock).mockResolvedValue({ count: 2 });
    (prisma.transportAllocation.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.transportAllocation.createMany as jest.Mock).mockResolvedValue({ count: 2 });
    (prisma.transportAllocation.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
  });

  it("returns 400 when routeId is missing", async () => {
    const req = makeReqStudents({ body: { academicYearId: "ay-1", studentIds: ["student-1"] } });
    const res = makeMockRes();

    await assignTransportFeeToStudents(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.transportRoute.findUnique).not.toHaveBeenCalled();
  });

  it("returns 400 when academicYearId is missing", async () => {
    const req = makeReqStudents({ body: { routeId: "route-1", studentIds: ["student-1"] } });
    const res = makeMockRes();

    await assignTransportFeeToStudents(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when studentIds is missing or empty", async () => {
    const req = makeReqStudents({ body: { routeId: "route-1", academicYearId: "ay-1", studentIds: [] } });
    const res = makeMockRes();

    await assignTransportFeeToStudents(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.transportRoute.findUnique).not.toHaveBeenCalled();
  });

  it("returns 404 when the route does not exist", async () => {
    (prisma.transportRoute.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReqStudents();
    const res = makeMockRes();

    await assignTransportFeeToStudents(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects a route from a different branch", async () => {
    (prisma.transportRoute.findUnique as jest.Mock).mockResolvedValue({ ...ROUTE, branchId: "branch-OTHER" });
    const req = makeReqStudents();
    const res = makeMockRes();

    await assignTransportFeeToStudents(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.student.findMany).not.toHaveBeenCalled();
  });

  it("rejects an academic year that doesn't belong to the route's branch", async () => {
    (prisma.academicYear.findUnique as jest.Mock).mockResolvedValue({ id: "ay-1", branchId: "branch-OTHER" });
    const req = makeReqStudents();
    const res = makeMockRes();

    await assignTransportFeeToStudents(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.student.findMany).not.toHaveBeenCalled();
  });

  it("returns 404 when one or more studentIds don't exist", async () => {
    (prisma.student.findMany as jest.Mock).mockResolvedValue([{ id: "student-1", branchId: "branch-1" }]);
    const req = makeReqStudents();
    const res = makeMockRes();

    await assignTransportFeeToStudents(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.feeAssignment.createMany).not.toHaveBeenCalled();
  });

  it("SECURITY: rejects when a student in the list belongs to a different branch than the route", async () => {
    (prisma.student.findMany as jest.Mock).mockResolvedValue([
      { id: "student-1", branchId: "branch-1" },
      { id: "student-2", branchId: "branch-OTHER" },
    ]);
    const req = makeReqStudents();
    const res = makeMockRes();

    await assignTransportFeeToStudents(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.feeAssignment.createMany).not.toHaveBeenCalled();
  });

  // Deliberately does NOT require the students to already be in
  // TransportAllocation for this route beforehand - see the
  // controller's doc comment - but it DOES create the fee assignments
  // AND allocate them to the route as a side effect (both students
  // have no existing allocation in this test's default mock, so both
  // should get a fresh TransportAllocation via createMany).
  it("creates fee assignments for every requested student, allocating those with no existing allocation to this route", async () => {
    const req = makeReqStudents();
    const res = makeMockRes();

    await assignTransportFeeToStudents(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.feeAssignment.createMany).toHaveBeenCalledWith({
      data: [
        { studentId: "student-1", feeStructureId: "fs-transport-1", totalAmount: 1500, paidAmount: 0, discount: 0, lateFee: 0, status: "PENDING" },
        { studentId: "student-2", feeStructureId: "fs-transport-1", totalAmount: 1500, paidAmount: 0, discount: 0, lateFee: 0, status: "PENDING" },
      ],
    });
    expect(prisma.transportAllocation.createMany).toHaveBeenCalledWith({
      data: [
        { studentId: "student-1", routeId: "route-1" },
        { studentId: "student-2", routeId: "route-1" },
      ],
    });
    expect(prisma.transportAllocation.updateMany).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: { created: 2, skipped: 0, total: 2, feeStructureId: "fs-transport-1" } })
    );
  });

  // BUG FIX: previously, picking specific students on the Transport
  // Route Fee > Specific Students tab created their FeeAssignment but
  // never touched TransportAllocation - so the route would still show
  // "0 students" (the count the Transport page and the "Entire Route"
  // tab both rely on) even though those students had just been billed
  // for it. This is the regression test for the fix.
  it("BUG FIX: leaves a student who already had this fee assigned but no allocation record correctly allocated too", async () => {
    (prisma.feeAssignment.findMany as jest.Mock).mockResolvedValue([{ studentId: "student-1" }]);
    const req = makeReqStudents();
    const res = makeMockRes();

    await assignTransportFeeToStudents(req, res);

    // student-1 is skipped for the fee (already assigned) but STILL
    // gets allocated, since createMany targets every requested
    // student with no existing allocation, not just the newly
    // fee-assigned ones.
    expect(prisma.transportAllocation.createMany).toHaveBeenCalledWith({
      data: [
        { studentId: "student-1", routeId: "route-1" },
        { studentId: "student-2", routeId: "route-1" },
      ],
    });
  });

  it("re-allocates a student who was on a different route instead of creating a duplicate allocation", async () => {
    (prisma.transportAllocation.findMany as jest.Mock).mockResolvedValue([
      { studentId: "student-1", routeId: "route-OTHER" },
    ]);
    const req = makeReqStudents();
    const res = makeMockRes();

    await assignTransportFeeToStudents(req, res);

    expect(prisma.transportAllocation.createMany).toHaveBeenCalledWith({ data: [{ studentId: "student-2", routeId: "route-1" }] });
    expect(prisma.transportAllocation.updateMany).toHaveBeenCalledWith({
      where: { studentId: { in: ["student-1"] } },
      data: { routeId: "route-1" },
    });
  });

  it("does not touch TransportAllocation at all when every student is already allocated to this exact route", async () => {
    (prisma.transportAllocation.findMany as jest.Mock).mockResolvedValue([
      { studentId: "student-1", routeId: "route-1" },
      { studentId: "student-2", routeId: "route-1" },
    ]);
    const req = makeReqStudents();
    const res = makeMockRes();

    await assignTransportFeeToStudents(req, res);

    expect(prisma.transportAllocation.createMany).not.toHaveBeenCalled();
    expect(prisma.transportAllocation.updateMany).not.toHaveBeenCalled();
  });

  it("auto-creates the route's FeeStructure (via the shared helper) when none exists yet", async () => {
    (prisma.feeStructure.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.feeStructure.create as jest.Mock).mockResolvedValue(STRUCTURE);
    const req = makeReqStudents();
    const res = makeMockRes();

    await assignTransportFeeToStudents(req, res);

    expect(prisma.feeStructure.create).toHaveBeenCalledWith({
      data: {
        branchId: "branch-1",
        academicYearId: "ay-1",
        transportRouteId: "route-1",
        feeCategoryId: "cat-transport",
        amount: 1500,
        frequency: "MONTHLY",
        dueDay: 10,
        lateFeeType: "NONE",
        lateFeeValue: 0,
        isActive: true,
      },
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("skips students already assigned this route's fee (no N+1 - one findMany, not one findUnique per student)", async () => {
    (prisma.feeAssignment.findMany as jest.Mock).mockResolvedValue([{ studentId: "student-1" }]);
    const req = makeReqStudents();
    const res = makeMockRes();

    await assignTransportFeeToStudents(req, res);

    expect(prisma.feeAssignment.createMany).toHaveBeenCalledWith({
      data: [{ studentId: "student-2", feeStructureId: "fs-transport-1", totalAmount: 1500, paidAmount: 0, discount: 0, lateFee: 0, status: "PENDING" }],
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: { created: 1, skipped: 1, total: 2, feeStructureId: "fs-transport-1" } })
    );
  });

  it("does not call createMany at all when every requested student is already assigned", async () => {
    (prisma.feeAssignment.findMany as jest.Mock).mockResolvedValue([{ studentId: "student-1" }, { studentId: "student-2" }]);
    const req = makeReqStudents();
    const res = makeMockRes();

    await assignTransportFeeToStudents(req, res);

    expect(prisma.feeAssignment.createMany).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: { created: 0, skipped: 2, total: 2, feeStructureId: "fs-transport-1" } })
    );
  });
});
