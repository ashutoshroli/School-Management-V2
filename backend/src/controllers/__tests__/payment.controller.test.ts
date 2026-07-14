import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    payment: { findFirst: jest.fn(), create: jest.fn(), count: jest.fn() },
    branch: { findUnique: jest.fn() },
    student: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
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

jest.mock("../../config/logger", () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
}));

jest.mock("../../config", () => ({
  config: {
    razorpay: { keyId: "test-key-id", keySecret: "test-key-secret", webhookSecret: "test-webhook-secret" },
  },
}));

import prisma from "../../config/database";
import { getValidatedFeeAssignment, recordFeePayment, notifyPaymentConfirmation } from "../../services/feePayment.service";
import { getRazorpayClient } from "../../config/razorpay";
import { config } from "../../config";
import { createRazorpayOrder, razorpayWebhook } from "../payment.controller";
import { AuthRequest } from "../../types";
import crypto from "crypto";
import { Request, Response } from "express";

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


describe("payment.controller - razorpayWebhook", () => {
  const WEBHOOK_SECRET = "test-webhook-secret";

  const makeWebhookReq = (body: Record<string, unknown>, opts: { validSignature?: boolean; noSignature?: boolean; noRawBody?: boolean } = {}): Request => {
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature =
      opts.noSignature ? undefined
      : opts.validSignature === false ? "invalid-signature"
      : crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");

    return {
      headers: signature ? { "x-razorpay-signature": signature } : {},
      rawBody: opts.noRawBody ? undefined : rawBody,
      body,
    } as unknown as Request;
  };

  const makeWebhookRes = (): Response => {
    const res: any = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  const PAYMENT_ENTITY = {
    id: "pay_1",
    amount: 500000, // paise -> 5000 rupees
    order_id: "order_1",
    notes: { branchId: "branch-1", studentId: "student-1", feeAssignmentId: "fa-1" },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (config as any).razorpay = { keyId: "test-key-id", keySecret: "test-key-secret", webhookSecret: WEBHOOK_SECRET };
    (prisma.payment.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.payment.count as jest.Mock).mockResolvedValue(0);
    (prisma.branch.findUnique as jest.Mock).mockResolvedValue({ code: "BR1" });
    (prisma.student.findUnique as jest.Mock).mockResolvedValue({ user: { name: "Test Student" } });
    (prisma.$transaction as jest.Mock).mockImplementation((fn: any) => fn({}));
    (getValidatedFeeAssignment as jest.Mock).mockResolvedValue({
      assignment: { totalAmount: 5000, paidAmount: 0, discount: 0, lateFee: 0 },
    });
    (recordFeePayment as jest.Mock).mockResolvedValue({ payment: { receiptNo: "RCP-BR1-000001" }, newStatus: "PAID" });
  });

  it("returns 503 when RAZORPAY_WEBHOOK_SECRET is not configured", async () => {
    (config as any).razorpay = { ...config.razorpay, webhookSecret: "" };
    const req = makeWebhookReq({ event: "payment.captured", payload: { payment: { entity: PAYMENT_ENTITY } } });
    const res = makeWebhookRes();

    await razorpayWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(recordFeePayment).not.toHaveBeenCalled();
  });

  it("returns 400 when the x-razorpay-signature header is missing", async () => {
    const req = makeWebhookReq({ event: "payment.captured", payload: { payment: { entity: PAYMENT_ENTITY } } }, { noSignature: true });
    const res = makeWebhookRes();

    await razorpayWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when the raw body was not captured", async () => {
    const req = makeWebhookReq({ event: "payment.captured", payload: { payment: { entity: PAYMENT_ENTITY } } }, { noRawBody: true });
    const res = makeWebhookRes();

    await razorpayWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("SECURITY: returns 400 when the signature does not match (does not process the event)", async () => {
    const req = makeWebhookReq({ event: "payment.captured", payload: { payment: { entity: PAYMENT_ENTITY } } }, { validSignature: false });
    const res = makeWebhookRes();

    await razorpayWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(recordFeePayment).not.toHaveBeenCalled();
  });

  it("payment.captured: records the fee payment and returns 200", async () => {
    const req = makeWebhookReq({ event: "payment.captured", payload: { payment: { entity: PAYMENT_ENTITY } } });
    const res = makeWebhookRes();

    await razorpayWebhook(req, res);

    expect(getValidatedFeeAssignment).toHaveBeenCalledWith("fa-1", "student-1", "branch-1");
    expect(recordFeePayment).toHaveBeenCalledWith(
      {},
      expect.any(Object),
      expect.objectContaining({
        branchId: "branch-1",
        studentId: "student-1",
        feeAssignmentId: "fa-1",
        amount: 5000,
        paymentMode: "ONLINE_RAZORPAY",
        transactionId: "pay_1",
      })
    );
    expect(notifyPaymentConfirmation).toHaveBeenCalledWith("student-1", "Test Student", 5000, "RCP-BR1-000001");
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("order.paid: records the fee payment via the same shared handler as payment.captured", async () => {
    const req = makeWebhookReq({ event: "order.paid", payload: { payment: { entity: PAYMENT_ENTITY } } });
    const res = makeWebhookRes();

    await razorpayWebhook(req, res);

    expect(recordFeePayment).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("IDEMPOTENCY: payment.captured is a no-op if this transactionId was already recorded", async () => {
    (prisma.payment.findFirst as jest.Mock).mockResolvedValue({ id: "existing-payment" });
    const req = makeWebhookReq({ event: "payment.captured", payload: { payment: { entity: PAYMENT_ENTITY } } });
    const res = makeWebhookRes();

    await razorpayWebhook(req, res);

    expect(recordFeePayment).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("payment.captured: ignored (no error) when notes are missing branchId/studentId/feeAssignmentId", async () => {
    const req = makeWebhookReq({
      event: "payment.captured",
      payload: { payment: { entity: { ...PAYMENT_ENTITY, notes: {} } } },
    });
    const res = makeWebhookRes();

    await razorpayWebhook(req, res);

    expect(getValidatedFeeAssignment).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("payment.failed: records a FAILED Payment row without touching the fee assignment, and returns 200", async () => {
    const failedEntity = { ...PAYMENT_ENTITY, error_code: "BAD_REQUEST_ERROR", error_description: "Card declined" };
    const req = makeWebhookReq({ event: "payment.failed", payload: { payment: { entity: failedEntity } } });
    const res = makeWebhookRes();

    await razorpayWebhook(req, res);

    expect(prisma.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        branchId: "branch-1",
        studentId: "student-1",
        feeAssignmentId: "fa-1",
        amount: 5000,
        paymentMode: "ONLINE_RAZORPAY",
        transactionId: "pay_1",
        status: "FAILED",
        remarks: expect.stringContaining("Card declined"),
      }),
    });
    // A failed payment must never touch FeeAssignment/accounting via recordFeePayment.
    expect(recordFeePayment).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("payment.failed: IDEMPOTENCY - does not create a second FAILED row for the same transactionId", async () => {
    (prisma.payment.findFirst as jest.Mock).mockResolvedValue({ id: "existing-failed-payment" });
    const req = makeWebhookReq({ event: "payment.failed", payload: { payment: { entity: PAYMENT_ENTITY } } });
    const res = makeWebhookRes();

    await razorpayWebhook(req, res);

    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("ignores an unrecognized event type but still acknowledges with 200", async () => {
    const req = makeWebhookReq({ event: "refund.processed", payload: {} });
    const res = makeWebhookRes();

    await razorpayWebhook(req, res);

    expect(recordFeePayment).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("catches an unexpected processing error and still acknowledges with 200 (avoids endless gateway retries)", async () => {
    (getValidatedFeeAssignment as jest.Mock).mockRejectedValue(new Error("DB unreachable"));
    const req = makeWebhookReq({ event: "payment.captured", payload: { payment: { entity: PAYMENT_ENTITY } } });
    const res = makeWebhookRes();

    await razorpayWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});
