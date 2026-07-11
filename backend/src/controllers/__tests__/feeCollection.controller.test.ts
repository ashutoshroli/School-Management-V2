import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    feeAssignment: { findUnique: jest.fn() },
    student: { findUnique: jest.fn() },
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
import { collectPayment } from "../feeCollection.controller";
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
