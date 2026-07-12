jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    student: { findUnique: jest.fn() },
    exam: { findMany: jest.fn() },
    mark: { findMany: jest.fn() },
    feeAssignment: { findUnique: jest.fn(), findMany: jest.fn() },
    payment: { findFirst: jest.fn() },
    notice: { findMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock("../../config/razorpay", () => ({
  isRazorpayConfigured: jest.fn(),
  getRazorpayClient: jest.fn(),
}));

jest.mock("../../services/feePayment.service", () => ({
  getValidatedFeeAssignment: jest.fn(),
  recordFeePayment: jest.fn(),
  notifyPaymentConfirmation: jest.fn(),
}));

import prisma from "../../config/database";
import { isRazorpayConfigured, getRazorpayClient } from "../../config/razorpay";
import { getValidatedFeeAssignment } from "../../services/feePayment.service";
import {
  lookupPublicResults,
  lookupPublicFeeStatus,
  createPublicFeePaymentOrder,
  verifyPublicFeePayment,
  getPublicNotices,
} from "../publicPortal.controller";
import { Request } from "express";

const makeMockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const makeReq = (overrides: any = {}): Request => ({ body: {}, params: {}, query: {}, ...overrides } as any);

const STUDENT = {
  id: "stu-1",
  admissionNo: "A100",
  isActive: true,
  dateOfBirth: new Date("2010-05-15T00:00:00.000Z"),
  classId: "class-1",
  user: { name: "Ravi Kumar" },
  class: { id: "class-1", name: "Class 5" },
  section: { name: "A" },
  branch: { id: "branch-1", name: "Main Campus" },
};

describe("publicPortal.controller - lookupPublicResults", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 400 when admissionNo or dateOfBirth is missing", async () => {
    const req = makeReq({ body: { admissionNo: "A100" } });
    const res = makeMockRes();

    await lookupPublicResults(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns found:false (not 404) when no student matches the admissionNo", async () => {
    (prisma.student.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ body: { admissionNo: "A999", dateOfBirth: "2010-05-15" } });
    const res = makeMockRes();

    await lookupPublicResults(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect((res.json as jest.Mock).mock.calls[0][0].data).toEqual({ found: false });
  });

  it("SECURITY: returns found:false when dateOfBirth does not match (never reveals which field was wrong)", async () => {
    (prisma.student.findUnique as jest.Mock).mockResolvedValue(STUDENT);
    const req = makeReq({ body: { admissionNo: "A100", dateOfBirth: "1999-01-01" } });
    const res = makeMockRes();

    await lookupPublicResults(req, res);

    expect((res.json as jest.Mock).mock.calls[0][0].data).toEqual({ found: false });
  });

  it("returns found:false for an inactive student even with correct admissionNo+DOB", async () => {
    (prisma.student.findUnique as jest.Mock).mockResolvedValue({ ...STUDENT, isActive: false });
    const req = makeReq({ body: { admissionNo: "A100", dateOfBirth: "2010-05-15" } });
    const res = makeMockRes();

    await lookupPublicResults(req, res);

    expect((res.json as jest.Mock).mock.calls[0][0].data).toEqual({ found: false });
  });

  it("only queries PUBLISHED exams for the student's class", async () => {
    (prisma.student.findUnique as jest.Mock).mockResolvedValue(STUDENT);
    (prisma.exam.findMany as jest.Mock).mockResolvedValue([]);
    const req = makeReq({ body: { admissionNo: "A100", dateOfBirth: "2010-05-15" } });
    const res = makeMockRes();

    await lookupPublicResults(req, res);

    expect(prisma.exam.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { classId: "class-1", isPublished: true } }));
  });

  it("returns per-exam subject marks and computed percentage on a match", async () => {
    (prisma.student.findUnique as jest.Mock).mockResolvedValue(STUDENT);
    (prisma.exam.findMany as jest.Mock).mockResolvedValue([{ id: "exam-1", name: "Unit Test 1", type: "UNIT_TEST" }]);
    (prisma.mark.findMany as jest.Mock).mockResolvedValue([
      { subject: { name: "Maths", code: "MTH" }, obtainedMarks: 45, maxMarks: 50, grade: "A" },
    ]);
    const req = makeReq({ body: { admissionNo: "A100", dateOfBirth: "2010-05-15" } });
    const res = makeMockRes();

    await lookupPublicResults(req, res);

    const payload = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(payload.found).toBe(true);
    expect(payload.results[0].percentage).toBe(90);
  });

  it("accepts a dateOfBirth match regardless of time-of-day component (calendar-day comparison)", async () => {
    (prisma.student.findUnique as jest.Mock).mockResolvedValue(STUDENT);
    (prisma.exam.findMany as jest.Mock).mockResolvedValue([]);
    const req = makeReq({ body: { admissionNo: "A100", dateOfBirth: "2010-05-15T18:30:00.000Z" } });
    const res = makeMockRes();

    await lookupPublicResults(req, res);

    expect((res.json as jest.Mock).mock.calls[0][0].data.found).toBe(true);
  });
});

describe("publicPortal.controller - lookupPublicFeeStatus", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns found:false when no student matches", async () => {
    (prisma.student.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ body: { admissionNo: "A999", dateOfBirth: "2010-05-15" } });
    const res = makeMockRes();

    await lookupPublicFeeStatus(req, res);

    expect((res.json as jest.Mock).mock.calls[0][0].data).toEqual({ found: false });
  });

  it("computes pending amount per fee assignment and a grand total", async () => {
    (prisma.student.findUnique as jest.Mock).mockResolvedValue(STUDENT);
    (prisma.feeAssignment.findMany as jest.Mock).mockResolvedValue([
      { id: "fa-1", totalAmount: 5000, paidAmount: 2000, discount: 0, lateFee: 100, status: "PARTIAL", feeStructure: { feeCategory: { name: "Tuition" } } },
    ]);
    const req = makeReq({ body: { admissionNo: "A100", dateOfBirth: "2010-05-15" } });
    const res = makeMockRes();

    await lookupPublicFeeStatus(req, res);

    const payload = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(payload.dues[0].pendingAmount).toBe(3100);
    expect(payload.totalPending).toBe(3100);
  });

  it("excludes fully-paid assignments from the dues list", async () => {
    (prisma.student.findUnique as jest.Mock).mockResolvedValue(STUDENT);
    (prisma.feeAssignment.findMany as jest.Mock).mockResolvedValue([
      { id: "fa-1", totalAmount: 5000, paidAmount: 5000, discount: 0, lateFee: 0, status: "PAID", feeStructure: { feeCategory: { name: "Tuition" } } },
    ]);
    const req = makeReq({ body: { admissionNo: "A100", dateOfBirth: "2010-05-15" } });
    const res = makeMockRes();

    await lookupPublicFeeStatus(req, res);

    const payload = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(payload.dues).toEqual([]);
    expect(payload.totalPending).toBe(0);
  });
});

describe("publicPortal.controller - createPublicFeePaymentOrder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isRazorpayConfigured as jest.Mock).mockReturnValue(true);
  });

  it("returns 503 when Razorpay is not configured", async () => {
    (isRazorpayConfigured as jest.Mock).mockReturnValue(false);
    const req = makeReq({ body: { admissionNo: "A100", dateOfBirth: "2010-05-15", feeAssignmentId: "fa-1" } });
    const res = makeMockRes();

    await createPublicFeePaymentOrder(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it("returns 404 when no student matches admissionNo+dateOfBirth (never trusts a bare feeAssignmentId)", async () => {
    (prisma.student.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ body: { admissionNo: "A999", dateOfBirth: "2010-05-15", feeAssignmentId: "fa-1" } });
    const res = makeMockRes();

    await createPublicFeePaymentOrder(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("rejects when the fee assignment is already fully paid", async () => {
    (prisma.student.findUnique as jest.Mock).mockResolvedValue(STUDENT);
    (getValidatedFeeAssignment as jest.Mock).mockResolvedValue({
      assignment: { totalAmount: 5000, paidAmount: 5000, discount: 0, lateFee: 0 },
    });
    const req = makeReq({ body: { admissionNo: "A100", dateOfBirth: "2010-05-15", feeAssignmentId: "fa-1" } });
    const res = makeMockRes();

    await createPublicFeePaymentOrder(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("creates a Razorpay order for the pending amount when valid", async () => {
    (prisma.student.findUnique as jest.Mock).mockResolvedValue(STUDENT);
    (getValidatedFeeAssignment as jest.Mock).mockResolvedValue({
      assignment: { totalAmount: 5000, paidAmount: 2000, discount: 0, lateFee: 0 },
    });
    const create = jest.fn().mockResolvedValue({ id: "order_1", amount: 300000, currency: "INR" });
    (getRazorpayClient as jest.Mock).mockReturnValue({ orders: { create } });
    const req = makeReq({ body: { admissionNo: "A100", dateOfBirth: "2010-05-15", feeAssignmentId: "fa-1" } });
    const res = makeMockRes();

    await createPublicFeePaymentOrder(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ amount: 300000, currency: "INR" }));
  });
});

describe("publicPortal.controller - verifyPublicFeePayment", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isRazorpayConfigured as jest.Mock).mockReturnValue(true);
  });

  it("returns 404 when no student matches", async () => {
    (prisma.student.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({
      body: {
        admissionNo: "A999", dateOfBirth: "2010-05-15", feeAssignmentId: "fa-1",
        razorpay_order_id: "o1", razorpay_payment_id: "p1", razorpay_signature: "sig",
      },
    });
    const res = makeMockRes();

    await verifyPublicFeePayment(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("rejects a signature that doesn't match the expected HMAC", async () => {
    (prisma.student.findUnique as jest.Mock).mockResolvedValue(STUDENT);
    const req = makeReq({
      body: {
        admissionNo: "A100", dateOfBirth: "2010-05-15", feeAssignmentId: "fa-1",
        razorpay_order_id: "o1", razorpay_payment_id: "p1", razorpay_signature: "wrong-sig",
      },
    });
    const res = makeMockRes();

    await verifyPublicFeePayment(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("publicPortal.controller - getPublicNotices", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.notice.findMany as jest.Mock).mockResolvedValue([]);
  });

  it("only queries notices flagged isPublic:true", async () => {
    const req = makeReq({ query: {} });
    const res = makeMockRes();

    await getPublicNotices(req, res);

    const whereArg = (prisma.notice.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.isPublic).toBe(true);
  });

  it("excludes expired notices via the expiryDate OR clause", async () => {
    const req = makeReq({ query: {} });
    const res = makeMockRes();

    await getPublicNotices(req, res);

    const whereArg = (prisma.notice.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.OR).toEqual([{ expiryDate: null }, { expiryDate: { gte: expect.any(Date) } }]);
  });
});
