import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    staff: { findUnique: jest.fn() },
    section: { findUnique: jest.fn(), findMany: jest.fn() },
    subjectTeacher: { count: jest.fn(), findMany: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { canTeacherAccessSection, getOwnAssignedSectionIds } from "../teacherAccess";
import { AuthRequest } from "../../types";

const makeReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
  ({ body: {}, params: {}, query: {}, user: { userId: "teacher-1", email: "t@test.com", role: UserRole.TEACHER, branchId: "branch-1" }, ...overrides } as any);

describe("teacherAccess - canTeacherAccessSection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("always returns true for non-TEACHER roles (never widens anyone else's access)", async () => {
    const req = makeReq({ user: { userId: "admin-1", email: "a@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" } });

    const result = await canTeacherAccessSection(req, "section-1");

    expect(result).toBe(true);
    expect(prisma.staff.findUnique).not.toHaveBeenCalled();
  });

  it("returns false when the TEACHER has no linked Staff record", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq();

    const result = await canTeacherAccessSection(req, "section-1");

    expect(result).toBe(false);
  });

  it("returns false when the section does not exist", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: "staff-1" });
    (prisma.section.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq();

    const result = await canTeacherAccessSection(req, "section-1");

    expect(result).toBe(false);
  });

  it("returns true when the teacher IS the section's class teacher", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: "staff-1" });
    (prisma.section.findUnique as jest.Mock).mockResolvedValue({ classId: "class-1", classTeacherId: "staff-1" });
    const req = makeReq();

    const result = await canTeacherAccessSection(req, "section-1");

    expect(result).toBe(true);
    expect(prisma.subjectTeacher.count).not.toHaveBeenCalled();
  });

  it("returns true when the teacher has a class-specific SubjectTeacher row for this section's class", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: "staff-1" });
    (prisma.section.findUnique as jest.Mock).mockResolvedValue({ classId: "class-1", classTeacherId: "staff-OTHER" });
    (prisma.subjectTeacher.count as jest.Mock).mockResolvedValue(1);
    const req = makeReq();

    const result = await canTeacherAccessSection(req, "section-1");

    expect(result).toBe(true);
    expect(prisma.subjectTeacher.count).toHaveBeenCalledWith({ where: { staffId: "staff-1", classId: "class-1" } });
  });

  it("SECURITY: returns false when the teacher is neither the class teacher nor has a SubjectTeacher row for this class", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: "staff-1" });
    (prisma.section.findUnique as jest.Mock).mockResolvedValue({ classId: "class-1", classTeacherId: "staff-OTHER" });
    (prisma.subjectTeacher.count as jest.Mock).mockResolvedValue(0);
    const req = makeReq();

    const result = await canTeacherAccessSection(req, "section-1");

    expect(result).toBe(false);
  });
});

describe("teacherAccess - getOwnAssignedSectionIds", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns an empty array with no queries when the user has no linked staff record", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq();

    const result = await getOwnAssignedSectionIds(req);

    expect(result).toEqual([]);
    expect(prisma.section.findMany).not.toHaveBeenCalled();
  });

  it("returns only class-teacher sections when there are no subject-teacher assignments", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: "staff-1" });
    (prisma.section.findMany as jest.Mock).mockResolvedValueOnce([{ id: "sec-1" }, { id: "sec-2" }]);
    (prisma.subjectTeacher.findMany as jest.Mock).mockResolvedValue([]);
    const req = makeReq();

    const result = await getOwnAssignedSectionIds(req);

    expect(result.sort()).toEqual(["sec-1", "sec-2"]);
  });

  it("de-duplicates sections that appear via both class-teacher and subject-teacher assignment", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: "staff-1" });
    (prisma.section.findMany as jest.Mock)
      .mockResolvedValueOnce([{ id: "sec-1" }]) // classTeacher sections
      .mockResolvedValueOnce([{ id: "sec-1" }, { id: "sec-2" }]); // sections in subject-assigned classes
    (prisma.subjectTeacher.findMany as jest.Mock).mockResolvedValue([{ classId: "class-1" }]);
    const req = makeReq();

    const result = await getOwnAssignedSectionIds(req);

    expect(result.sort()).toEqual(["sec-1", "sec-2"]);
  });

  it("skips the second section query entirely when there are no subject-teacher assignments to look up", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: "staff-1" });
    (prisma.section.findMany as jest.Mock).mockResolvedValueOnce([]);
    (prisma.subjectTeacher.findMany as jest.Mock).mockResolvedValue([]);
    const req = makeReq();

    const result = await getOwnAssignedSectionIds(req);

    expect(result).toEqual([]);
    expect(prisma.section.findMany).toHaveBeenCalledTimes(1);
  });
});
