import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    feeAssignment: { findUnique: jest.fn(), findMany: jest.fn(), createMany: jest.fn() },
    feeStructure: { findUnique: jest.fn() },
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
import { collectPayment, assignFeesToStudents } from "../feeCollection.controller";
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
