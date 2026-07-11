import { createAccountSchema, createVoucherSchema } from "../accounting.validator";
import { createStudentSchema } from "../student.validator";
import { collectPaymentSchema, createRazorpayOrderSchema, verifyRazorpayPaymentSchema } from "../fee.validator";
import { createBranchAdminSchema } from "../branch.validator";

/**
 * Regression tests for a bug where several "create X" forms had their
 * dead `branchId: ""` field removed from the frontend (branchId is now
 * always resolved server-side via resolveEffectiveBranchId - see
 * branchScope.ts), but the corresponding Zod validators were never
 * updated to match. Since `validate()` middleware runs BEFORE the
 * controller, `branchId: z.string().min(1, ...)` rejected every one of
 * these requests with "Validation failed" before the controller's own
 * (correct) fallback logic ever got a chance to run - i.e. the exact
 * "kuchh bhi add karna chaah raha hu to validation failed bata raha h"
 * symptom.
 *
 * Each of these schemas must accept a request body with branchId
 * omitted entirely (not just an empty string) - that's what the
 * updated frontend forms actually send.
 */
describe("branchId is optional at the validator level (matches controller-side resolution)", () => {
  it("createAccountSchema accepts a body with no branchId", () => {
    const result = createAccountSchema.safeParse({
      body: { name: "Cash", code: "1000", type: "ASSET" },
      query: {},
      params: {},
    });
    expect(result.success).toBe(true);
  });

  it("createVoucherSchema accepts a body with no branchId", () => {
    const result = createVoucherSchema.safeParse({
      body: {
        type: "PAYMENT",
        date: "2025-06-01",
        entries: [{ debitAccountId: "acc-1", creditAccountId: "acc-2", amount: 500 }],
      },
      query: {},
      params: {},
    });
    expect(result.success).toBe(true);
  });

  it("createStudentSchema accepts a body with no branchId", () => {
    const result = createStudentSchema.safeParse({
      body: {
        classId: "class-1",
        sectionId: "section-1",
        name: "Ravi Kumar",
        email: "ravi@test.com",
        dateOfBirth: "2012-05-10",
        gender: "MALE",
      },
      query: {},
      params: {},
    });
    expect(result.success).toBe(true);
  });

  it("collectPaymentSchema accepts a body with no branchId", () => {
    const result = collectPaymentSchema.safeParse({
      body: {
        studentId: "student-1",
        feeAssignmentId: "fa-1",
        amount: "5000",
        paymentMode: "CASH",
      },
      query: {},
      params: {},
    });
    expect(result.success).toBe(true);
  });

  it("createRazorpayOrderSchema accepts a body with no branchId", () => {
    const result = createRazorpayOrderSchema.safeParse({
      body: { studentId: "student-1", feeAssignmentId: "fa-1" },
      query: {},
      params: {},
    });
    expect(result.success).toBe(true);
  });

  it("verifyRazorpayPaymentSchema accepts a body with no branchId", () => {
    const result = verifyRazorpayPaymentSchema.safeParse({
      body: {
        studentId: "student-1",
        feeAssignmentId: "fa-1",
        razorpay_order_id: "order-1",
        razorpay_payment_id: "pay-1",
        razorpay_signature: "sig-1",
      },
      query: {},
      params: {},
    });
    expect(result.success).toBe(true);
  });

  // Sanity check the other direction too - these schemas should still
  // reject requests missing their genuinely-required fields, so this
  // fix doesn't silently turn into "everything is optional now".
  it("createAccountSchema still rejects a body missing the required name/code/type", () => {
    const result = createAccountSchema.safeParse({ body: {}, query: {}, params: {} });
    expect(result.success).toBe(false);
  });

  it("createStudentSchema still rejects a body missing classId/sectionId", () => {
    const result = createStudentSchema.safeParse({
      body: { name: "Ravi Kumar", email: "ravi@test.com", dateOfBirth: "2012-05-10", gender: "MALE" },
      query: {},
      params: {},
    });
    expect(result.success).toBe(false);
  });
});

/**
 * Regression test for a second, related bug: the "Add Branch Admin"
 * form's password field is intentionally left blank by default
 * ("Leave blank for default: Admin@123"). A blank <input> submits as
 * "" - NOT undefined - so `password: z.string().min(6, ...).optional()`
 * still rejected it (`.optional()` only permits undefined, an empty
 * string still has to satisfy `.min(6)`), with the same generic
 * "Validation failed" symptom.
 */
describe("createBranchAdminSchema - blank password field", () => {
  const baseBody = { branchId: "branch-1", name: "Priya Admin", email: "priya@test.com" };

  it("accepts a body with password omitted entirely", () => {
    const result = createBranchAdminSchema.safeParse({ body: baseBody, query: {}, params: {} });
    expect(result.success).toBe(true);
  });

  it("accepts a body with password as an empty string (blank form field)", () => {
    const result = createBranchAdminSchema.safeParse({
      body: { ...baseBody, password: "" },
      query: {},
      params: {},
    });
    expect(result.success).toBe(true);
  });

  it("still rejects a password that's too short when one IS provided", () => {
    const result = createBranchAdminSchema.safeParse({
      body: { ...baseBody, password: "abc" },
      query: {},
      params: {},
    });
    expect(result.success).toBe(false);
  });
});
