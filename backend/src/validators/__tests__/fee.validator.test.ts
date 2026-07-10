import { collectPaymentSchema, createRefundSchema, bulkAssignFeesSchema } from "../fee.validator";

describe("collectPaymentSchema", () => {
  const validBody = {
    branchId: "branch-1",
    studentId: "student-1",
    feeAssignmentId: "fa-1",
    amount: 500,
    paymentMode: "CASH",
  };

  it("accepts a valid payload", () => {
    const result = collectPaymentSchema.safeParse({ body: validBody });
    expect(result.success).toBe(true);
  });

  it("coerces a string amount to a number", () => {
    const result = collectPaymentSchema.safeParse({ body: { ...validBody, amount: "500" } });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.body.amount).toBe(500);
      expect(typeof result.data.body.amount).toBe("number");
    }
  });

  it("rejects a zero or negative amount", () => {
    expect(collectPaymentSchema.safeParse({ body: { ...validBody, amount: 0 } }).success).toBe(false);
    expect(collectPaymentSchema.safeParse({ body: { ...validBody, amount: -50 } }).success).toBe(false);
  });

  it("rejects a non-numeric amount string", () => {
    const result = collectPaymentSchema.safeParse({ body: { ...validBody, amount: "not-a-number" } });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid paymentMode", () => {
    const result = collectPaymentSchema.safeParse({ body: { ...validBody, paymentMode: "BITCOIN" } });
    expect(result.success).toBe(false);
  });

  it("rejects a payload missing required fields", () => {
    const { branchId, ...rest } = validBody;
    const result = collectPaymentSchema.safeParse({ body: rest });
    expect(result.success).toBe(false);
  });
});

describe("createRefundSchema", () => {
  it("accepts a valid refund payload", () => {
    const result = createRefundSchema.safeParse({
      body: { paymentId: "payment-1", amount: 100, reason: "Overpayment" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a refund with a zero amount", () => {
    const result = createRefundSchema.safeParse({
      body: { paymentId: "payment-1", amount: 0, reason: "Overpayment" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a refund with an empty reason", () => {
    const result = createRefundSchema.safeParse({
      body: { paymentId: "payment-1", amount: 100, reason: "" },
    });
    expect(result.success).toBe(false);
  });
});

describe("bulkAssignFeesSchema", () => {
  it("accepts a valid payload without the optional sectionId", () => {
    const result = bulkAssignFeesSchema.safeParse({
      body: { feeStructureId: "fs-1", classId: "class-1" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a payload missing classId", () => {
    const result = bulkAssignFeesSchema.safeParse({ body: { feeStructureId: "fs-1" } });
    expect(result.success).toBe(false);
  });
});
