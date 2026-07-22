import { recordFeePayment, recalculateFeeAssignmentDiscount } from "../feePayment.service";

/**
 * These tests exercise recordFeePayment()'s pure calculation logic
 * (late fee computation, paid/status transitions, receipt numbering)
 * against a mocked Prisma transaction client - they intentionally do
 * NOT hit a real database, so they can run in any environment without
 * DATABASE_URL configured.
 */

// Cast to `any` at the return site - these tests only need the fields
// recordFeePayment() actually reads (dueDay/lateFeeType/lateFeeValue/etc),
// not every column of the real Prisma FeeStructure/Student models.
const makeAssignment = (overrides: Record<string, any> = {}): any => ({
  id: "fa-1",
  studentId: "student-1",
  feeStructureId: "fs-1",
  totalAmount: 1000 as any,
  paidAmount: 0 as any,
  discount: 0 as any,
  lateFee: 0 as any,
  status: "PENDING",
  feeStructure: {
    id: "fs-1",
    dueDay: 10,
    lateFeeType: "NONE",
    lateFeeValue: 0 as any,
  },
  student: { branchId: "branch-1" },
  ...overrides,
});

const makeMockTx = () => {
  const payments: any[] = [];
  // Chart-of-accounts lookup table used by autoPostToAccounting() inside
  // recordFeePayment(). Every branchId exercised by a test in this file
  // needs its own Cash (1001) + Fee Income (3001) entry here, or
  // autoPostToAccounting() throws "Accounting not configured for
  // branch <id>" (by design - see its own comment) and the test fails
  // for a reason unrelated to whatever it's actually testing.
  const accounts: Record<string, any> = {
    "branch-1:1001": { id: "cash-account" },
    "branch-1:3001": { id: "fee-income-account" },
    "branch-a:1001": { id: "cash-account-a" },
    "branch-a:3001": { id: "fee-income-account-a" },
    "branch-b:1001": { id: "cash-account-b" },
    "branch-b:3001": { id: "fee-income-account-b" },
  };

  return {
    branch: {
      findUnique: jest.fn().mockResolvedValue({ code: "MAIN" }),
    },
    // Backs the 3-day late-fee grace period lookup (spec Section 19)
    // inside recordFeePayment() - only ever queried when
    // feeStructure.lateFeeType !== "NONE"; defaults to null here (no
    // FeeCategory row found), which recordFeePayment treats as "use
    // the spec's default of 3 grace days" - matching this suite's
    // existing lateFeeType: "FIXED" test cases below without needing
    // per-test setup.
    feeCategory: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    payment: {
      count: jest.fn().mockResolvedValue(payments.length),
      create: jest.fn().mockImplementation(({ data }) => {
        const payment = { id: `payment-${payments.length + 1}`, ...data };
        payments.push(payment);
        return Promise.resolve(payment);
      }),
    },
    feeAssignment: {
      update: jest.fn().mockResolvedValue({}),
    },
    account: {
      findFirst: jest.fn().mockImplementation(({ where }: any) => {
        const key = `${where.branchId}:${where.code}`;
        return Promise.resolve(accounts[key] || null);
      }),
    },
    voucher: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: "voucher-1" }),
    },
    voucherEntry: {
      create: jest.fn().mockResolvedValue({}),
    },
  } as any;
};

describe("recordFeePayment", () => {
  it("creates a payment with the full amount and marks the assignment PAID when fully covered", async () => {
    const tx = makeMockTx();
    const assignment = makeAssignment();

    const result = await recordFeePayment(tx, assignment, {
      branchId: "branch-1",
      studentId: "student-1",
      feeAssignmentId: "fa-1",
      amount: 1000,
      paymentMode: "CASH" as any,
    });

    expect(result.payment.amount).toBe(1000);
    expect(result.newStatus).toBe("PAID");
    expect(tx.feeAssignment.update).toHaveBeenCalledWith({
      where: { id: "fa-1" },
      data: { paidAmount: 1000, lateFee: 0, status: "PAID" },
    });
  });

  it("marks the assignment PARTIAL when only part of the amount is paid", async () => {
    const tx = makeMockTx();
    const assignment = makeAssignment();

    const result = await recordFeePayment(tx, assignment, {
      branchId: "branch-1",
      studentId: "student-1",
      feeAssignmentId: "fa-1",
      amount: 400,
      paymentMode: "CASH" as any,
    });

    expect(result.newStatus).toBe("PARTIAL");
  });

  it("applies a FIXED late fee per day when the due date has passed and not waived", async () => {
    const tx = makeMockTx();
    // Due day 1 of an already-past month, so "now" is comfortably after it.
    const assignment = makeAssignment({
      feeStructure: { id: "fs-1", dueDay: 1, lateFeeType: "FIXED", lateFeeValue: 10 as any },
    });

    const result = await recordFeePayment(tx, assignment, {
      branchId: "branch-1",
      studentId: "student-1",
      feeAssignmentId: "fa-1",
      amount: 1000,
      paymentMode: "CASH" as any,
    });

    // Late fee should be > 0 since dueDay=1 has already passed this month.
    expect(result.lateFeeCharged).toBeGreaterThan(0);
  });

  it("does not apply a late fee when waiveLateFee is true, even past the due date", async () => {
    const tx = makeMockTx();
    const assignment = makeAssignment({
      feeStructure: { id: "fs-1", dueDay: 1, lateFeeType: "FIXED", lateFeeValue: 10 as any },
    });

    const result = await recordFeePayment(tx, assignment, {
      branchId: "branch-1",
      studentId: "student-1",
      feeAssignmentId: "fa-1",
      amount: 1000,
      paymentMode: "CASH" as any,
      waiveLateFee: true,
    });

    expect(result.lateFeeCharged).toBe(0);
  });

  it("throws (and would roll back the transaction) if the branch has no chart of accounts configured", async () => {
    const tx = makeMockTx();
    tx.account.findFirst.mockResolvedValue(null); // simulate missing Cash/Fee Income accounts
    const assignment = makeAssignment();

    await expect(
      recordFeePayment(tx, assignment, {
        branchId: "branch-1",
        studentId: "student-1",
        feeAssignmentId: "fa-1",
        amount: 1000,
        paymentMode: "CASH" as any,
      })
    ).rejects.toThrow(/Accounting not configured/);
  });

  it("generates a zero-padded receipt number based on the existing payment count, qualified by branch code", async () => {
    const tx = makeMockTx();
    tx.payment.count.mockResolvedValue(41); // simulate 41 existing payments
    const assignment = makeAssignment();

    const result = await recordFeePayment(tx, assignment, {
      branchId: "branch-1",
      studentId: "student-1",
      feeAssignmentId: "fa-1",
      amount: 1000,
      paymentMode: "CASH" as any,
    });

    expect(result.payment.receiptNo).toBe("RCP-MAIN-000042");
  });

  // BUG FIX: Payment.receiptNo is globally unique, but was previously
  // generated from a branch-scoped count alone (e.g. "RCP-000001") -
  // the first payment collected in a second branch collided with an
  // identical receiptNo already used by another branch and crashed
  // with a Prisma unique-constraint violation. This regression-tests
  // that two different branches, both recording their very first
  // payment (count=0), now generate different receipt numbers.
  it("BUG FIX: two different branches recording their first payment never generate the same receiptNo", async () => {
    const txBranchA = makeMockTx();
    txBranchA.branch.findUnique.mockResolvedValue({ code: "MAIN" });
    txBranchA.payment.count.mockResolvedValue(0);

    const txBranchB = makeMockTx();
    txBranchB.branch.findUnique.mockResolvedValue({ code: "NORTH" });
    txBranchB.payment.count.mockResolvedValue(0);

    const assignment = makeAssignment();

    const resultA = await recordFeePayment(txBranchA, assignment, {
      branchId: "branch-a",
      studentId: "student-1",
      feeAssignmentId: "fa-1",
      amount: 1000,
      paymentMode: "CASH" as any,
    });
    const resultB = await recordFeePayment(txBranchB, assignment, {
      branchId: "branch-b",
      studentId: "student-2",
      feeAssignmentId: "fa-2",
      amount: 1000,
      paymentMode: "CASH" as any,
    });

    expect(resultA.payment.receiptNo).toBe("RCP-MAIN-000001");
    expect(resultB.payment.receiptNo).toBe("RCP-NORTH-000001");
    expect(resultA.payment.receiptNo).not.toBe(resultB.payment.receiptNo);
  });
});


/**
 * BUG FIX regression tests: recalculateFeeAssignmentDiscount is the
 * function that actually makes a granted discount reduce a fee's
 * pending amount - previously nothing ever wrote to
 * FeeAssignment.discount when a StudentDiscount was created/toggled/
 * deleted, so a discount had zero real effect. See this function's
 * own doc comment in feePayment.service.ts for the full root cause.
 */
describe("recalculateFeeAssignmentDiscount", () => {
  const makeMockTx = () => ({
    feeAssignment: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    studentDiscount: {
      findMany: jest.fn(),
    },
  });

  it("does nothing when the fee assignment does not exist", async () => {
    const tx: any = makeMockTx();
    tx.feeAssignment.findUnique.mockResolvedValue(null);

    await recalculateFeeAssignmentDiscount(tx, "fa-missing");

    expect(tx.studentDiscount.findMany).not.toHaveBeenCalled();
    expect(tx.feeAssignment.update).not.toHaveBeenCalled();
  });

  it("sums a single fixed-amount active discount into FeeAssignment.discount", async () => {
    const tx: any = makeMockTx();
    tx.feeAssignment.findUnique.mockResolvedValue({ totalAmount: 1000 as any });
    tx.studentDiscount.findMany.mockResolvedValue([{ value: 150 as any, isPercent: false }]);

    await recalculateFeeAssignmentDiscount(tx, "fa-1");

    // Sibling discount requires manual Principal approval (spec
    // Section 19) - the query now also filters to approvalStatus:
    // "APPROVED" (every non-SIBLING discount defaults to APPROVED at
    // creation, so this is a no-op filter for the fixed-amount
    // discount this test exercises, but the query shape itself
    // changed).
    expect(tx.studentDiscount.findMany).toHaveBeenCalledWith({
      where: { feeAssignmentId: "fa-1", isActive: true, approvalStatus: "APPROVED" },
      select: { value: true, isPercent: true },
    });
    expect(tx.feeAssignment.update).toHaveBeenCalledWith({ where: { id: "fa-1" }, data: { discount: 150 } });
  });

  it("computes a percentage discount against the assignment's totalAmount", async () => {
    const tx: any = makeMockTx();
    tx.feeAssignment.findUnique.mockResolvedValue({ totalAmount: 1000 as any });
    tx.studentDiscount.findMany.mockResolvedValue([{ value: 10 as any, isPercent: true }]);

    await recalculateFeeAssignmentDiscount(tx, "fa-1");

    expect(tx.feeAssignment.update).toHaveBeenCalledWith({ where: { id: "fa-1" }, data: { discount: 100 } });
  });

  it("sums multiple active discounts (percentage + fixed) additively against the original totalAmount", async () => {
    const tx: any = makeMockTx();
    tx.feeAssignment.findUnique.mockResolvedValue({ totalAmount: 1000 as any });
    tx.studentDiscount.findMany.mockResolvedValue([
      { value: 10 as any, isPercent: true }, // 100
      { value: 50 as any, isPercent: false }, // 50
    ]);

    await recalculateFeeAssignmentDiscount(tx, "fa-1");

    expect(tx.feeAssignment.update).toHaveBeenCalledWith({ where: { id: "fa-1" }, data: { discount: 150 } });
  });

  it("caps the total discount at totalAmount so it can never exceed what was actually charged", async () => {
    const tx: any = makeMockTx();
    tx.feeAssignment.findUnique.mockResolvedValue({ totalAmount: 1000 as any });
    tx.studentDiscount.findMany.mockResolvedValue([
      { value: 80 as any, isPercent: true }, // 800
      { value: 50 as any, isPercent: true }, // 500 -> combined 1300, over totalAmount
    ]);

    await recalculateFeeAssignmentDiscount(tx, "fa-1");

    expect(tx.feeAssignment.update).toHaveBeenCalledWith({ where: { id: "fa-1" }, data: { discount: 1000 } });
  });

  it("resets discount to 0 when there are no active discounts left (e.g. after a delete/deactivate)", async () => {
    const tx: any = makeMockTx();
    tx.feeAssignment.findUnique.mockResolvedValue({ totalAmount: 1000 as any });
    tx.studentDiscount.findMany.mockResolvedValue([]);

    await recalculateFeeAssignmentDiscount(tx, "fa-1");

    expect(tx.feeAssignment.update).toHaveBeenCalledWith({ where: { id: "fa-1" }, data: { discount: 0 } });
  });
});
