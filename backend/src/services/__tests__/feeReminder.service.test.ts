jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    student: { findMany: jest.fn() },
  },
}));

jest.mock("../notification.service", () => ({
  notify: jest.fn(),
}));

import prisma from "../../config/database";
import { notify } from "../notification.service";
import { sendFeeReminders } from "../feeReminder.service";

const makeStudent = (overrides: Record<string, any> = {}) => ({
  id: "student-1",
  user: { name: "Test Student" },
  feeAssignments: [
    {
      totalAmount: 1000 as any,
      paidAmount: 200 as any,
      discount: 0 as any,
      lateFee: 0 as any,
      feeStructure: { dueDay: 10 },
    },
  ],
  parents: [
    {
      parent: {
        user: { id: "parent-user-1", name: "Test Parent", email: "parent@test.com", phone: "9876543210" },
      },
    },
  ],
  ...overrides,
});

describe("sendFeeReminders", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("sends a reminder to every parent of every defaulting student with a positive pending balance", async () => {
    (prisma.student.findMany as jest.Mock).mockResolvedValue([makeStudent()]);
    (notify as jest.Mock).mockResolvedValue(undefined);

    const result = await sendFeeReminders("branch-1");

    expect(result.totalDefaulters).toBe(1);
    expect(result.notified).toBe(1);
    expect(result.skipped).toBe(0);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "parent-user-1",
        type: "FEE_DUE",
        channels: ["EMAIL", "SMS"],
      })
    );
  });

  it("skips students whose pending balance is zero or negative despite a non-PAID status", async () => {
    const student = makeStudent({
      feeAssignments: [
        { totalAmount: 1000 as any, paidAmount: 1000 as any, discount: 0 as any, lateFee: 0 as any, feeStructure: { dueDay: 10 } },
      ],
    });
    (prisma.student.findMany as jest.Mock).mockResolvedValue([student]);

    const result = await sendFeeReminders("branch-1");

    expect(result.skipped).toBe(1);
    expect(result.notified).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it("skips students with no linked parent accounts", async () => {
    const student = makeStudent({ parents: [] });
    (prisma.student.findMany as jest.Mock).mockResolvedValue([student]);

    const result = await sendFeeReminders("branch-1");

    expect(result.skipped).toBe(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it("notifies every linked parent (father + mother) for a single student", async () => {
    const student = makeStudent({
      parents: [
        { parent: { user: { id: "parent-user-1", name: "Father", email: "f@test.com", phone: "9876543210" } } },
        { parent: { user: { id: "parent-user-2", name: "Mother", email: "m@test.com", phone: "9876543211" } } },
      ],
    });
    (prisma.student.findMany as jest.Mock).mockResolvedValue([student]);
    (notify as jest.Mock).mockResolvedValue(undefined);

    const result = await sendFeeReminders("branch-1");

    expect(result.notified).toBe(2);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("collects per-parent errors without throwing when notify() rejects", async () => {
    (prisma.student.findMany as jest.Mock).mockResolvedValue([makeStudent()]);
    (notify as jest.Mock).mockRejectedValue(new Error("SMTP down"));

    const result = await sendFeeReminders("branch-1");

    expect(result.notified).toBe(0);
    expect(result.errors).toEqual([{ studentId: "student-1", error: "SMTP down" }]);
  });

  it("returns zero defaulters when no students have pending fees", async () => {
    (prisma.student.findMany as jest.Mock).mockResolvedValue([]);

    const result = await sendFeeReminders("branch-1");

    expect(result).toEqual({ totalDefaulters: 0, notified: 0, skipped: 0, errors: [] });
  });
});
