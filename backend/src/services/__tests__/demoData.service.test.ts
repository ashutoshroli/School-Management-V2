jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    branch: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    academicYear: { findFirst: jest.fn() },
    class: { findMany: jest.fn() },
    subject: { findMany: jest.fn() },
    feeCategory: { findMany: jest.fn() },
    student: { count: jest.fn(), create: jest.fn() },
  },
}));

jest.mock("../defaultChartOfAccounts", () => ({
  seedDefaultAccountsForBranch: jest.fn(),
}));

jest.mock("../feePayment.service", () => ({
  recordFeePayment: jest.fn(),
}));

import prisma from "../../config/database";
import { generateDemoDataForBranch } from "../demoData.service";

describe("demoData.service - generateDemoDataForBranch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("throws a clear error when the branch does not exist", async () => {
    (prisma.branch.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(generateDemoDataForBranch("branch-missing", "admin-1")).rejects.toThrow("Branch not found");
  });

  it("throws a clear, actionable error when the branch has no academic year yet", async () => {
    (prisma.branch.findUnique as jest.Mock).mockResolvedValue({ id: "branch-1", code: "MAIN-001" });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ organizationId: "org-1" });
    (prisma.academicYear.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(generateDemoDataForBranch("branch-1", "admin-1")).rejects.toThrow(/academic year/i);
  });

  it("throws a clear, actionable error when the branch has no classes/sections yet", async () => {
    (prisma.branch.findUnique as jest.Mock).mockResolvedValue({ id: "branch-1", code: "MAIN-001" });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ organizationId: "org-1" });
    (prisma.academicYear.findFirst as jest.Mock).mockResolvedValue({ id: "ay-1", branchId: "branch-1", startDate: new Date(), isActive: true });
    (prisma.class.findMany as jest.Mock).mockResolvedValue([]);

    await expect(generateDemoDataForBranch("branch-1", "admin-1")).rejects.toThrow(/classes/i);
  });
});
