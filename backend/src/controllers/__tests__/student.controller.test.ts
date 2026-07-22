import { UserRole } from "@prisma/client";

jest.mock("../../services/auditLog.service", () => ({
  logAuditFromRequest: jest.fn(),
}));

jest.mock("../../services/notification.service", () => ({
  notify: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../services/notification/emailTemplates", () => ({
  welcomeEmail: jest.fn().mockReturnValue({ subject: "Welcome", text: "Welcome text", html: "<p>Welcome</p>" }),
}));

jest.mock("bcryptjs", () => ({
  hash: jest.fn().mockResolvedValue("hashed-one-time-password"),
}));

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    branch: { findUnique: jest.fn() },
    // findMany backs generateNextRollNo's auto roll-number lookup
    // (Point 6 - Manual Roll No. Generation) - defaults to an empty
    // roster so auto-generated roll numbers start at "1" unless a
    // test overrides it.
    student: { count: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
    // Backs createStudent's non-blocking seat-capacity warning check
    // (spec Section 18) - defaults (via beforeEach below) to a section
    // with plenty of capacity so existing tests see no warning.
    section: { findUnique: jest.fn() },
    user: { update: jest.fn() },
    $transaction: jest.fn(),
  },
}));

import bcrypt from "bcryptjs";
import prisma from "../../config/database";
import { createStudent, resetStudentPassword } from "../student.controller";
import { AuthRequest } from "../../types";

const makeMockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const baseBody = {
  classId: "class-1",
  sectionId: "section-1",
  name: "Ravi Kumar",
  email: "ravi@test.com",
  dateOfBirth: "2012-05-10",
  gender: "MALE",
};

const makeReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
  ({
    body: { ...baseBody },
    params: {},
    query: {},
    user: { userId: "admin-1", email: "admin@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1", organizationId: "org-1" },
    ...overrides,
  } as any);

describe("student.controller - createStudent", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.branch.findUnique as jest.Mock).mockResolvedValue({ code: "MAIN" });
    (prisma.student.count as jest.Mock).mockResolvedValue(0);
    (prisma.student.findMany as jest.Mock).mockResolvedValue([]);
    // Default: plenty of capacity, so the non-blocking seat-capacity
    // warning (spec Section 18) never fires for the existing tests
    // below, which don't exercise that behavior.
    (prisma.section.findUnique as jest.Mock).mockResolvedValue({ capacity: 40, name: "A" });
    (prisma.student.findUnique as jest.Mock).mockResolvedValue({
      id: "student-1",
      user: { name: "Ravi Kumar", email: "ravi@test.com", phone: null },
      class: { name: "Class 5" },
      section: { name: "A" },
      parents: [],
    });

    // Simulate the transaction by giving the callback a minimal tx
    // client that mirrors the real Prisma transaction client shape
    // used inside createStudent.
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback: any) => {
      const tx = {
        branch: prisma.branch,
        student: {
          ...prisma.student,
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "student-1", ...data })),
        },
        user: {
          create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "user-1", ...data })),
          findUnique: jest.fn().mockResolvedValue(null),
        },
        parent: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "parent-1", ...data })),
        },
        studentParent: {
          create: jest.fn().mockResolvedValue({}),
        },
      };
      return callback(tx);
    });
  });

  it("BUG FIX: admits the student under the caller's own branch when the client sends an empty branchId", async () => {
    const req = makeReq({ body: { ...baseBody, branchId: "" } });
    const res = makeMockRes();

    await createStudent(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    // generateAdmissionNo is called with the resolved branchId - verify
    // via the branch.findUnique lookup it triggers.
    expect(prisma.branch.findUnique).toHaveBeenCalledWith({ where: { id: "branch-1" } });
  });

  it("BUG FIX: admits the student under the caller's own branch when branchId is omitted entirely", async () => {
    const req = makeReq({ body: { ...baseBody } });
    const res = makeMockRes();

    await createStudent(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(prisma.branch.findUnique).toHaveBeenCalledWith({ where: { id: "branch-1" } });
  });

  it("returns 400 when no branchId can be resolved", async () => {
    const req = makeReq({
      body: { ...baseBody, branchId: "" },
      user: { userId: "u1", email: "e", role: UserRole.ACCOUNTANT, branchId: undefined, organizationId: "org-1" },
    });
    const res = makeMockRes();

    await createStudent(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("SECURITY: silently neutralizes a Branch Admin trying to target a different branch (creates under their own branch instead)", async () => {
    const req = makeReq({ body: { ...baseBody, branchId: "branch-OTHER" } });
    const res = makeMockRes();

    await createStudent(req, res);

    // The malicious branchId is ignored - admission proceeds under the caller's own branch
    expect(res.status).toHaveBeenCalledWith(201);
    expect(prisma.branch.findUnique).toHaveBeenCalledWith({ where: { id: "branch-1" } });
  });

  it("SUPER_ADMIN can admit a student into any branch by explicitly sending its branchId", async () => {
    const req = makeReq({
      body: { ...baseBody, branchId: "branch-target" },
      user: { userId: "super-1", email: "super@test.com", role: UserRole.SUPER_ADMIN, branchId: "branch-1" },
    });
    const res = makeMockRes();

    await createStudent(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(prisma.branch.findUnique).toHaveBeenCalledWith({ where: { id: "branch-target" } });
  });

  // BUG FIX: Student.admissionNo is globally unique, but was previously
  // generated using only the first 4 characters of the branch code
  // (e.g. branch code "MAIN1" and "MAIN2" both slice to "MAIN" and
  // produce identical admissionNo values for each branch's first
  // student). Using the FULL branch code instead guarantees no
  // collision, since Branch.code itself is globally unique.
  it("BUG FIX: generates an admissionNo using the FULL branch code, not just its first 4 characters", async () => {
    (prisma.branch.findUnique as jest.Mock).mockResolvedValue({ code: "NORTHCAMPUS" });
    (prisma.student.count as jest.Mock).mockResolvedValue(0);

    let capturedAdmissionNo: string | undefined;
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback: any) => {
      const tx = {
        branch: prisma.branch,
        student: {
          ...prisma.student,
          create: jest.fn().mockImplementation(({ data }: any) => {
            capturedAdmissionNo = data.admissionNo;
            return Promise.resolve({ id: "student-1", ...data });
          }),
        },
        user: {
          create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "user-1", ...data })),
          findUnique: jest.fn().mockResolvedValue(null),
        },
        parent: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
        studentParent: { create: jest.fn().mockResolvedValue({}) },
      };
      return callback(tx);
    });

    const req = makeReq({ body: { ...baseBody, branchId: "" } });
    const res = makeMockRes();

    await createStudent(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(capturedAdmissionNo).toBe("NORTHCAMPUS-00001");
    // Explicitly NOT truncated to the first 4 characters ("NORT-00001"),
    // which is what would collide with another branch code also
    // starting with "NORT".
    expect(capturedAdmissionNo).not.toBe("NORT-00001");
  });

  // BUG FIX: Student.cardId is an OPTIONAL @unique column. The "New
  // Student Admission" form always sends cardId: "" when the RFID
  // field is left blank (the common case - most schools don't use
  // RFID). An empty string is a real, distinct value to Postgres
  // (unlike NULL, which @unique permits any number of), so the FIRST
  // student admitted with a blank card ID succeeded and every
  // subsequent one crashed on a unique-constraint violation on
  // cardId: "" - this is the actual root cause behind repeated
  // "Failed to add student" reports. Verifies the create payload sent
  // to Prisma has cardId omitted/undefined (-> written as NULL), never
  // the literal empty string, whenever the client sends "".
  it("BUG FIX: normalizes a blank cardId (\"\") to undefined instead of writing an empty string", async () => {
    let capturedCardId: string | null | undefined = "not-set";
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback: any) => {
      const tx = {
        branch: prisma.branch,
        student: {
          ...prisma.student,
          create: jest.fn().mockImplementation(({ data }: any) => {
            capturedCardId = data.cardId;
            return Promise.resolve({ id: "student-1", ...data });
          }),
        },
        user: {
          create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "user-1", ...data })),
          findUnique: jest.fn().mockResolvedValue(null),
        },
        parent: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
        studentParent: { create: jest.fn().mockResolvedValue({}) },
      };
      return callback(tx);
    });

    const req = makeReq({ body: { ...baseBody, cardId: "" } });
    const res = makeMockRes();

    await createStudent(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(capturedCardId).toBeUndefined();
  });

  it("preserves a real, non-blank cardId value", async () => {
    let capturedCardId: string | null | undefined = "not-set";
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback: any) => {
      const tx = {
        branch: prisma.branch,
        student: {
          ...prisma.student,
          create: jest.fn().mockImplementation(({ data }: any) => {
            capturedCardId = data.cardId;
            return Promise.resolve({ id: "student-1", ...data });
          }),
        },
        user: {
          create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "user-1", ...data })),
          findUnique: jest.fn().mockResolvedValue(null),
        },
        parent: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
        studentParent: { create: jest.fn().mockResolvedValue({}) },
      };
      return callback(tx);
    });

    const req = makeReq({ body: { ...baseBody, cardId: "RFID-12345" } });
    const res = makeMockRes();

    await createStudent(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(capturedCardId).toBe("RFID-12345");
  });
});

describe("student.controller - createStudent (seat-capacity warning, spec Section 18)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.branch.findUnique as jest.Mock).mockResolvedValue({ code: "MAIN" });
    (prisma.student.count as jest.Mock).mockResolvedValue(41); // over capacity after this admission
    (prisma.student.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.student.findUnique as jest.Mock).mockResolvedValue({
      id: "student-1",
      branchId: "branch-1",
      user: { name: "Ravi Kumar", email: "ravi@test.com", phone: null },
      class: { name: "Class 5" },
      section: { name: "A" },
      parents: [],
    });
    (prisma.section.findUnique as jest.Mock).mockResolvedValue({ capacity: 40, name: "A" });
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback: any) => {
      const tx = {
        branch: prisma.branch,
        student: { ...prisma.student, create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "student-1", ...data })) },
        user: { create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "user-1", ...data })), findUnique: jest.fn().mockResolvedValue(null) },
        parent: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
        studentParent: { create: jest.fn().mockResolvedValue({}) },
      };
      return callback(tx);
    });
  });

  it("returns a non-blocking seatCapacityWarning when the section is now over capacity, but still admits the student (201)", async () => {
    const req = makeReq({ body: { ...baseBody } });
    const res = makeMockRes();

    await createStudent(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const payload = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(payload.seatCapacityWarning).toContain("over capacity");
  });

  it("returns seatCapacityWarning: null when the section still has room", async () => {
    (prisma.student.count as jest.Mock).mockResolvedValue(10);
    const req = makeReq({ body: { ...baseBody } });
    const res = makeMockRes();

    await createStudent(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const payload = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(payload.seatCapacityWarning).toBeNull();
  });
});

describe("student.controller - resetStudentPassword", () => {
  const STUDENT = {
    id: "student-1",
    branchId: "branch-1",
    userId: "user-1",
    user: { id: "user-1", name: "Ravi Kumar", email: "ravi@test.com" },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.student.findUnique as jest.Mock).mockResolvedValue(STUDENT);
    (prisma.user.update as jest.Mock).mockResolvedValue({});
  });

  it("returns 404 when the student does not exist", async () => {
    (prisma.student.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { id: "student-1" } });
    const res = makeMockRes();

    await resetStudentPassword(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("SECURITY: rejects a student from a different branch", async () => {
    (prisma.student.findUnique as jest.Mock).mockResolvedValue({ ...STUDENT, branchId: "branch-OTHER" });
    const req = makeReq({ params: { id: "student-1" } });
    const res = makeMockRes();

    await resetStudentPassword(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("hashes and saves a new password on the student's own User record", async () => {
    const req = makeReq({ params: { id: "student-1" } });
    const res = makeMockRes();

    await resetStudentPassword(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { password: "hashed-one-time-password" },
    });
    expect(bcrypt.hash).toHaveBeenCalledTimes(1);
    // 12 salt rounds, matching every other password hash in the app
    // (changePassword, createBranchAdmin, ...).
    expect((bcrypt.hash as jest.Mock).mock.calls[0][1]).toBe(12);
  });

  // SECURITY-CRITICAL: the whole point of a one-time password reveal
  // is that the plaintext is shown to the admin exactly once and never
  // persisted anywhere else - verify the response actually contains a
  // plaintext password (not the hash), and that whatever gets audit-
  // logged does NOT contain it.
  it("returns the plaintext one-time password in the response, and does not include it in the audit log", async () => {
    const req = makeReq({ params: { id: "student-1" } });
    const res = makeMockRes();

    await resetStudentPassword(req, res);

    const jsonPayload = (res.json as jest.Mock).mock.calls[0][0];
    expect(jsonPayload.data.oneTimePassword).toBeDefined();
    expect(typeof jsonPayload.data.oneTimePassword).toBe("string");
    expect(jsonPayload.data.oneTimePassword).not.toBe("hashed-one-time-password");
    expect(jsonPayload.data.email).toBe("ravi@test.com");

    const { logAuditFromRequest } = require("../../services/auditLog.service");
    expect(logAuditFromRequest).toHaveBeenCalledTimes(1);
    const auditCallArgs = JSON.stringify(logAuditFromRequest.mock.calls[0]);
    expect(auditCallArgs).not.toContain(jsonPayload.data.oneTimePassword);
  });

  it("generates a fresh, different password on each call (never reuses the previous reset's password)", async () => {
    const req = makeReq({ params: { id: "student-1" } });
    const res1 = makeMockRes();
    const res2 = makeMockRes();

    await resetStudentPassword(req, res1);
    await resetStudentPassword(req, res2);

    const password1 = (res1.json as jest.Mock).mock.calls[0][0].data.oneTimePassword;
    const password2 = (res2.json as jest.Mock).mock.calls[0][0].data.oneTimePassword;
    expect(password1).not.toBe(password2);
  });

  it("the generated one-time password satisfies changePasswordSchema's own strength rule (8+ chars, uppercase, digit)", async () => {
    const req = makeReq({ params: { id: "student-1" } });
    const res = makeMockRes();

    await resetStudentPassword(req, res);

    const password = (res.json as jest.Mock).mock.calls[0][0].data.oneTimePassword;
    expect(password.length).toBeGreaterThanOrEqual(8);
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[0-9]/);
  });
});
