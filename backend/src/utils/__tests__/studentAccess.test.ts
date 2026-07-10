import { UserRole } from "@prisma/client";
import { AuthRequest } from "../../types";

// Mock the Prisma client module before importing the code under test,
// since studentAccess.ts talks to the DB via `prisma.student`/`prisma.studentParent`.
jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    student: { findUnique: jest.fn() },
    studentParent: { findFirst: jest.fn(), findMany: jest.fn() },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
import prisma from "../../config/database";
import { canAccessStudentRecord, getOwnChildStudentIds } from "../studentAccess";

const mockedStudentFindUnique = prisma.student.findUnique as jest.Mock;
const mockedStudentParentFindFirst = prisma.studentParent.findFirst as jest.Mock;
const mockedStudentParentFindMany = prisma.studentParent.findMany as jest.Mock;

const makeReq = (role: UserRole, userId = "user-1"): AuthRequest =>
  ({ user: { userId, email: "test@example.com", role } } as unknown as AuthRequest);

describe("canAccessStudentRecord", () => {
  it("returns false when there is no authenticated user", async () => {
    const req = { user: undefined } as unknown as AuthRequest;
    expect(await canAccessStudentRecord(req, "student-1")).toBe(false);
  });

  it("allows staff roles (SUPER_ADMIN/BRANCH_ADMIN/ACCOUNTANT/TEACHER) without a DB lookup", async () => {
    for (const role of [UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN, UserRole.ACCOUNTANT, UserRole.TEACHER]) {
      const req = makeReq(role);
      expect(await canAccessStudentRecord(req, "student-1")).toBe(true);
    }
    expect(mockedStudentFindUnique).not.toHaveBeenCalled();
  });

  it("allows a STUDENT to access their own record", async () => {
    mockedStudentFindUnique.mockResolvedValue({ userId: "user-1" });
    const req = makeReq(UserRole.STUDENT, "user-1");
    expect(await canAccessStudentRecord(req, "student-1")).toBe(true);
  });

  it("denies a STUDENT access to another student's record (IDOR prevention)", async () => {
    mockedStudentFindUnique.mockResolvedValue({ userId: "someone-else" });
    const req = makeReq(UserRole.STUDENT, "user-1");
    expect(await canAccessStudentRecord(req, "student-1")).toBe(false);
  });

  it("allows a PARENT to access a linked child's record", async () => {
    mockedStudentParentFindFirst.mockResolvedValue({ id: "link-1" });
    const req = makeReq(UserRole.PARENT, "parent-user-1");
    expect(await canAccessStudentRecord(req, "student-1")).toBe(true);
    expect(mockedStudentParentFindFirst).toHaveBeenCalledWith({
      where: { studentId: "student-1", parent: { userId: "parent-user-1" } },
    });
  });

  it("denies a PARENT access to a student that is not their child (IDOR prevention)", async () => {
    mockedStudentParentFindFirst.mockResolvedValue(null);
    const req = makeReq(UserRole.PARENT, "parent-user-1");
    expect(await canAccessStudentRecord(req, "student-1")).toBe(false);
  });

  it("denies access for any other/unrecognized role", async () => {
    const req = makeReq(UserRole.LIBRARIAN);
    expect(await canAccessStudentRecord(req, "student-1")).toBe(false);
  });
});

describe("getOwnChildStudentIds", () => {
  it("returns an empty array for a non-PARENT role", async () => {
    const req = makeReq(UserRole.STUDENT);
    expect(await getOwnChildStudentIds(req)).toEqual([]);
    expect(mockedStudentParentFindMany).not.toHaveBeenCalled();
  });

  it("returns the linked child student IDs for a PARENT", async () => {
    mockedStudentParentFindMany.mockResolvedValue([{ studentId: "s1" }, { studentId: "s2" }]);
    const req = makeReq(UserRole.PARENT, "parent-user-1");
    expect(await getOwnChildStudentIds(req)).toEqual(["s1", "s2"]);
    expect(mockedStudentParentFindMany).toHaveBeenCalledWith({
      where: { parent: { userId: "parent-user-1" } },
      select: { studentId: true },
    });
  });
});
