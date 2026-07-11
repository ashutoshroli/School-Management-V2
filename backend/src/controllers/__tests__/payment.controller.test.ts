import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {},
}));

jest.mock("../../config/razorpay", () => ({
  isRazorpayConfigured: jest.fn().mockReturnValue(true),
  getRazorpayClient: jest.fn().mockReturnValue({
    orders: { create: jest.fn().mockResolvedValue({ id: "order-1", amount: 500000, currency: "INR" }) },
  }),
}));

jest.mock("../../utils/studentAccess", () => ({
  canAccessStudentRecord: jest.fn().mockResolvedValue(true),
}));

jest.mock("../../services/feePayment.service", () => ({
  getValidatedFeeAssignment: jest.fn(),
  recordFeePayment: jest.fn(),
  notifyPaymentConfirmation: jest.fn(),
}));

import { getValidatedFeeAssignment } from "../../services/feePayment.service";
import { getRazorpayClient } from "../../config/razorpay";
import { createRazorpayOrder } from "../payment.controller";
import { AuthRequest } from "../../types";

const makeMockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const baseBody = { studentId: "student-1", feeAssignmentId: "fa-1" };

const makeReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
  ({
    body: { ...baseBody },
    params: {},
    query: {},
    user: { userId: "parent-1", email: "parent@test.com", role: UserRole.PARENT, branchId: "branch-1" },
    ...overrides,
  } as any);

describe("payment.controller - createRazorpayOrder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getValidatedFeeAssignment as jest.Mock).mockResolvedValue({
      assignment: { totalAmount: 10000, paidAmount: 0, discount: 0, lateFee: 0 },
    });
    (getRazorpayClient as jest.Mock).mockReturnValue({
      orders: { create: jest.fn().mockResolvedValue({ id: "order-1", amount: 1000000, currency: "INR" }) },
    });
  });

  it("BUG FIX: falls back to the caller's own branch when the client sends an empty branchId", async () => {
    const req = makeReq({ body: { ...baseBody, branchId: "" } });
    const res = makeMockRes();

    await createRazorpayOrder(req, res);

    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(getValidatedFeeAssignment).toHaveBeenCalledWith("fa-1", "student-1", "branch-1");
  });

  it("returns 400 when no branchId can be resolved", async () => {
    const req = makeReq({
      body: { ...baseBody, branchId: "" },
      user: { userId: "parent-1", email: "parent@test.com", role: UserRole.PARENT, branchId: undefined },
    });
    const res = makeMockRes();

    await createRazorpayOrder(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(getValidatedFeeAssignment).not.toHaveBeenCalled();
  });

  it("SECURITY: silently neutralizes when the caller sends a different branchId (non-Super-Admin gets their own branch used)", async () => {
    const req = makeReq({ body: { ...baseBody, branchId: "branch-OTHER" } });
    const res = makeMockRes();

    await createRazorpayOrder(req, res);

    // The malicious branchId is ignored - fee validation uses the caller's own branch
    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(getValidatedFeeAssignment).toHaveBeenCalledWith("fa-1", "student-1", "branch-1");
  });
});
