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

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    branch: { findUnique: jest.fn() },
    student: { count: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}));

import prisma from "../../config/database";
import { createStudent } from "../student.controller";
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
