import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    branch: { findUnique: jest.fn(), upsert: jest.fn(), delete: jest.fn(), count: jest.fn() },
    user: { findUnique: jest.fn(), upsert: jest.fn(), count: jest.fn(), delete: jest.fn() },
    academicYear: { findFirst: jest.fn(), upsert: jest.fn(), findMany: jest.fn(), deleteMany: jest.fn(), count: jest.fn() },
    class: { findMany: jest.fn(), upsert: jest.fn(), count: jest.fn(), deleteMany: jest.fn() },
    subject: { findMany: jest.fn(), upsert: jest.fn(), count: jest.fn(), deleteMany: jest.fn() },
    feeCategory: { findMany: jest.fn(), upsert: jest.fn(), count: jest.fn(), deleteMany: jest.fn() },
    student: { count: jest.fn(), create: jest.fn() },
    organization: { upsert: jest.fn(), deleteMany: jest.fn() },
    staff: { upsert: jest.fn(), findFirst: jest.fn(), count: jest.fn(), delete: jest.fn() },
    section: { upsert: jest.fn(), count: jest.fn(), deleteMany: jest.fn(), updateMany: jest.fn() },
    leaveType: { upsert: jest.fn() },
    permission: { upsert: jest.fn() },
    account: { count: jest.fn(), findMany: jest.fn(), createMany: jest.fn(), deleteMany: jest.fn() },
    payment: { count: jest.fn() },
    voucher: { count: jest.fn() },
    feeStructure: { count: jest.fn(), deleteMany: jest.fn() },
    exam: { count: jest.fn(), findMany: jest.fn(), deleteMany: jest.fn() },
    timetable: { count: jest.fn(), findMany: jest.fn(), deleteMany: jest.fn() },
    timetableSlot: { deleteMany: jest.fn() },
    mark: { deleteMany: jest.fn() },
    promotion: { count: jest.fn(), deleteMany: jest.fn() },
    notice: { count: jest.fn() },
    libraryBook: { count: jest.fn() },
    inventoryItem: { count: jest.fn() },
    transportRoute: { count: jest.fn() },
    hostelBuilding: { count: jest.fn() },
    admissionInquiry: { count: jest.fn() },
    attendanceDevice: { count: jest.fn() },
    classSubject: { deleteMany: jest.fn() },
    subjectTeacher: { deleteMany: jest.fn() },
    feeInstallment: { deleteMany: jest.fn() },
    staffDocument: { deleteMany: jest.fn() },
    staffAttendance: { deleteMany: jest.fn() },
    leaveApplication: { deleteMany: jest.fn() },
    salaryStructure: { deleteMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock("../defaultChartOfAccounts", () => ({
  seedDefaultAccountsForBranch: jest.fn(),
  DEFAULT_CHART_OF_ACCOUNTS: Array.from({ length: 19 }, (_, i) => ({ name: `Account ${i}`, code: String(1000 + i), type: "ASSET" })),
}));

jest.mock("../feePayment.service", () => ({
  recordFeePayment: jest.fn(),
}));

import prisma from "../../config/database";
import {
  generateDemoDataForBranch,
  getDemoDataStatus,
  removeDemoData,
  seedDemoData,
  DEMO_BRANCH_ID,
  DEMO_SUPER_ADMIN_EMAIL,
} from "../demoData.service";

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

const zeroCounts = () => {
  (prisma.student.count as jest.Mock).mockResolvedValue(0);
  (prisma.staff.count as jest.Mock).mockResolvedValue(1); // just the demo branch admin
  (prisma.payment.count as jest.Mock).mockResolvedValue(0);
  (prisma.voucher.count as jest.Mock).mockResolvedValue(0);
  (prisma.feeStructure.count as jest.Mock).mockResolvedValue(0);
  (prisma.exam.count as jest.Mock).mockResolvedValue(0);
  (prisma.timetable.count as jest.Mock).mockResolvedValue(0);
  (prisma.promotion.count as jest.Mock).mockResolvedValue(0);
  (prisma.notice.count as jest.Mock).mockResolvedValue(0);
  (prisma.libraryBook.count as jest.Mock).mockResolvedValue(0);
  (prisma.inventoryItem.count as jest.Mock).mockResolvedValue(0);
  (prisma.transportRoute.count as jest.Mock).mockResolvedValue(0);
  (prisma.hostelBuilding.count as jest.Mock).mockResolvedValue(0);
  (prisma.admissionInquiry.count as jest.Mock).mockResolvedValue(0);
  (prisma.attendanceDevice.count as jest.Mock).mockResolvedValue(0);
  (prisma.class.count as jest.Mock).mockResolvedValue(15);
  (prisma.section.count as jest.Mock).mockResolvedValue(45);
  (prisma.subject.count as jest.Mock).mockResolvedValue(16);
  (prisma.feeCategory.count as jest.Mock).mockResolvedValue(11);
  (prisma.account.count as jest.Mock).mockResolvedValue(19);
};

describe("demoData.service - getDemoDataStatus (structural)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("reports not seeded when the demo branch does not exist", async () => {
    (prisma.branch.findUnique as jest.Mock).mockResolvedValue(null);

    const status = await getDemoDataStatus();

    expect(status.seeded).toBe(false);
    expect(status.branchId).toBeNull();
    expect(status.canRemove).toBe(false);
  });

  it("reports seeded + removable when the demo branch exists with no extra real data", async () => {
    (prisma.branch.findUnique as jest.Mock).mockResolvedValue({ id: DEMO_BRANCH_ID });
    zeroCounts();

    const status = await getDemoDataStatus();

    expect(status.seeded).toBe(true);
    expect(status.branchId).toBe(DEMO_BRANCH_ID);
    expect(status.canRemove).toBe(true);
    expect(status.blockedReasons).toEqual([]);
    expect(status.counts.classes).toBe(15);
  });

  it("reports NOT removable and lists reasons when real students exist", async () => {
    (prisma.branch.findUnique as jest.Mock).mockResolvedValue({ id: DEMO_BRANCH_ID });
    zeroCounts();
    (prisma.student.count as jest.Mock).mockResolvedValue(3);
    (prisma.payment.count as jest.Mock).mockResolvedValue(5);

    const status = await getDemoDataStatus();

    expect(status.canRemove).toBe(false);
    expect(status.blockedReasons).toEqual(
      expect.arrayContaining([expect.stringContaining("3 student"), expect.stringContaining("5 fee payment")])
    );
  });

  it("does not flag the single seeded demo Branch Admin as an extra staff member", async () => {
    (prisma.branch.findUnique as jest.Mock).mockResolvedValue({ id: DEMO_BRANCH_ID });
    zeroCounts();
    (prisma.staff.count as jest.Mock).mockResolvedValue(1);

    const status = await getDemoDataStatus();

    expect(status.canRemove).toBe(true);
  });

  it("flags real/generated staff beyond the demo Branch Admin as a removal blocker", async () => {
    (prisma.branch.findUnique as jest.Mock).mockResolvedValue({ id: DEMO_BRANCH_ID });
    zeroCounts();
    (prisma.staff.count as jest.Mock).mockResolvedValue(3); // demo admin + 2 more

    const status = await getDemoDataStatus();

    expect(status.canRemove).toBe(false);
    expect(status.blockedReasons).toEqual(
      expect.arrayContaining([expect.stringContaining("2 staff member(s) beyond the demo Branch Admin")])
    );
  });
});

describe("demoData.service - removeDemoData (structural)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("reports nothing to remove when the demo branch doesn't exist", async () => {
    (prisma.branch.findUnique as jest.Mock).mockResolvedValue(null);

    const result = await removeDemoData("caller-1");

    expect(result.removed).toBe(false);
    expect(result.message).toMatch(/No demo data found/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses to remove when real records exist, returning blockedReasons", async () => {
    (prisma.branch.findUnique as jest.Mock).mockResolvedValue({ id: DEMO_BRANCH_ID });
    zeroCounts();
    (prisma.student.count as jest.Mock).mockResolvedValue(2);

    const result = await removeDemoData("caller-1");

    expect(result.removed).toBe(false);
    expect(result.blockedReasons).toEqual(expect.arrayContaining([expect.stringContaining("2 student")]));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("removes the demo branch/org/admins when nothing real is layered on top", async () => {
    (prisma.branch.findUnique as jest.Mock).mockResolvedValue({ id: DEMO_BRANCH_ID });
    zeroCounts();
    (prisma.staff.findFirst as jest.Mock).mockResolvedValue({ id: "staff-1", userId: "user-branchadmin" });
    (prisma.class.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.subject.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.academicYear.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.exam.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.timetable.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: "user-superadmin", email: DEMO_SUPER_ADMIN_EMAIL });
    (prisma.user.count as jest.Mock).mockResolvedValue(1); // another super admin still exists
    (prisma.branch.count as jest.Mock).mockResolvedValue(0);

    let txSpy: any = null;
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback: any) => {
      txSpy = {
        staffDocument: { deleteMany: jest.fn() },
        subjectTeacher: { deleteMany: jest.fn() },
        staffAttendance: { deleteMany: jest.fn() },
        leaveApplication: { deleteMany: jest.fn() },
        salaryStructure: { deleteMany: jest.fn() },
        section: { updateMany: jest.fn(), deleteMany: jest.fn() },
        staff: { delete: jest.fn() },
        user: { delete: jest.fn(), findUnique: prisma.user.findUnique, count: prisma.user.count },
        class: { findMany: prisma.class.findMany, deleteMany: jest.fn() },
        subject: { findMany: prisma.subject.findMany, deleteMany: jest.fn() },
        academicYear: { findMany: prisma.academicYear.findMany, deleteMany: jest.fn() },
        exam: { findMany: prisma.exam.findMany, deleteMany: jest.fn() },
        timetable: { findMany: prisma.timetable.findMany, deleteMany: jest.fn() },
        timetableSlot: { deleteMany: jest.fn() },
        mark: { deleteMany: jest.fn() },
        promotion: { deleteMany: jest.fn() },
        classSubject: { deleteMany: jest.fn() },
        feeInstallment: { deleteMany: jest.fn() },
        feeStructure: { deleteMany: jest.fn() },
        feeCategory: { deleteMany: jest.fn() },
        account: { deleteMany: jest.fn() },
        branch: { delete: jest.fn(), count: prisma.branch.count },
        organization: { deleteMany: jest.fn() },
      };
      return callback(txSpy);
    });

    const result = await removeDemoData("caller-other");

    expect(result.removed).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(txSpy.branch.delete).toHaveBeenCalledWith({ where: { id: DEMO_BRANCH_ID } });
    // The demo Super Admin is removed since the caller is a DIFFERENT
    // user and another Super Admin still exists afterwards.
    expect(txSpy.user.delete).toHaveBeenCalledWith({ where: { id: "user-superadmin" } });
  });

  it("never deletes the demo Super Admin if the caller IS that account", async () => {
    (prisma.branch.findUnique as jest.Mock).mockResolvedValue({ id: DEMO_BRANCH_ID });
    zeroCounts();
    (prisma.staff.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.class.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.subject.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.academicYear.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.exam.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.timetable.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: "user-superadmin", email: DEMO_SUPER_ADMIN_EMAIL });
    (prisma.branch.count as jest.Mock).mockResolvedValue(0);

    let txSpy: any = null;
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback: any) => {
      txSpy = {
        class: { findMany: prisma.class.findMany, deleteMany: jest.fn() },
        subject: { findMany: prisma.subject.findMany, deleteMany: jest.fn() },
        academicYear: { findMany: prisma.academicYear.findMany, deleteMany: jest.fn() },
        exam: { findMany: prisma.exam.findMany, deleteMany: jest.fn() },
        timetable: { findMany: prisma.timetable.findMany, deleteMany: jest.fn() },
        timetableSlot: { deleteMany: jest.fn() },
        mark: { deleteMany: jest.fn() },
        promotion: { deleteMany: jest.fn() },
        classSubject: { deleteMany: jest.fn() },
        subjectTeacher: { deleteMany: jest.fn() },
        feeInstallment: { deleteMany: jest.fn() },
        feeStructure: { deleteMany: jest.fn() },
        feeCategory: { deleteMany: jest.fn() },
        section: { deleteMany: jest.fn() },
        account: { deleteMany: jest.fn() },
        branch: { delete: jest.fn(), count: prisma.branch.count },
        user: { delete: jest.fn(), findUnique: prisma.user.findUnique, count: jest.fn() },
        organization: { deleteMany: jest.fn() },
      };
      return callback(txSpy);
    });

    const result = await removeDemoData("user-superadmin");

    expect(result.removed).toBe(true);
    // The caller's own account must never be deleted, even though it
    // matches the demo Super Admin's email.
    expect(txSpy.user.delete).not.toHaveBeenCalledWith({ where: { id: "user-superadmin" } });
  });

  it("surfaces a clear error message instead of throwing when the transaction fails", async () => {
    (prisma.branch.findUnique as jest.Mock).mockResolvedValue({ id: DEMO_BRANCH_ID });
    zeroCounts();
    (prisma.staff.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.$transaction as jest.Mock).mockRejectedValue(new Error("FK violation"));

    const result = await removeDemoData("caller-1");

    expect(result.removed).toBe(false);
    expect(result.message).toMatch(/Failed to remove demo data/);
  });
});

describe("demoData.service - seedDemoData (structural)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("upserts the demo organization, both admin logins, and the branch", async () => {
    (prisma.organization.upsert as jest.Mock).mockResolvedValue({ id: "org-main", name: "ABC Public School Group" });
    (prisma.user.upsert as jest.Mock).mockImplementation(({ create }: any) => Promise.resolve({ id: `user-${create.email}`, ...create }));
    (prisma.branch.upsert as jest.Mock).mockResolvedValue({ id: DEMO_BRANCH_ID, name: "ABC Public School - Main Campus" });
    (prisma.staff.upsert as jest.Mock).mockResolvedValue({});
    (prisma.academicYear.upsert as jest.Mock).mockResolvedValue({});
    (prisma.class.upsert as jest.Mock).mockResolvedValue({});
    (prisma.class.findMany as jest.Mock).mockResolvedValue([{ id: "class-1" }]);
    (prisma.section.upsert as jest.Mock).mockResolvedValue({});
    (prisma.subject.upsert as jest.Mock).mockResolvedValue({});
    (prisma.feeCategory.upsert as jest.Mock).mockResolvedValue({});
    (prisma.leaveType.upsert as jest.Mock).mockResolvedValue({});
    (prisma.account.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.account.createMany as jest.Mock).mockResolvedValue({});
    (prisma.permission.upsert as jest.Mock).mockResolvedValue({});

    const summary = await seedDemoData();

    expect(prisma.organization.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "org-main" } })
    );
    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: DEMO_SUPER_ADMIN_EMAIL } })
    );
    const superAdminCall = (prisma.user.upsert as jest.Mock).mock.calls.find(
      (c: any) => c[0].where.email === DEMO_SUPER_ADMIN_EMAIL
    );
    expect(superAdminCall[0].create.role).toBe(UserRole.SUPER_ADMIN);
    expect(summary.classes).toBeGreaterThan(0);
    expect(summary.accounts).toBeGreaterThan(0);
  });
});
