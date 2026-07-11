import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    class: { findUnique: jest.fn() },
    section: { findUnique: jest.fn() },
    student: { findMany: jest.fn(), updateMany: jest.fn() },
    promotion: { createMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

import prisma from "../../config/database";
import { bulkPromote } from "../promotion.controller";
import { AuthRequest } from "../../types";

const makeMockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const makeReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
  ({
    body: {},
    params: {},
    query: {},
    user: { userId: "admin-1", email: "admin@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" },
    ...overrides,
  } as any);

const FROM_CLASS = { id: "class-5", branchId: "branch-1" };
const TO_CLASS = { id: "class-6", branchId: "branch-1" };
const TO_SECTION = { id: "section-6a", branchId: "branch-1", classId: "class-6" };

const basePayload = {
  academicYearId: "year-1",
  fromClassId: "class-5",
  toClassId: "class-6",
  toSectionId: "section-6a",
};

describe("promotion.controller - bulkPromote", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.class.findUnique as jest.Mock).mockImplementation(({ where: { id } }: any) =>
      Promise.resolve(id === "class-5" ? FROM_CLASS : id === "class-6" ? TO_CLASS : null)
    );
    (prisma.section.findUnique as jest.Mock).mockResolvedValue(TO_SECTION);
    (prisma.$transaction as jest.Mock).mockResolvedValue([]);
  });

  describe("validation / not-found handling", () => {
    it("returns 404 when the source class does not exist", async () => {
      (prisma.class.findUnique as jest.Mock).mockImplementation(({ where: { id } }: any) =>
        Promise.resolve(id === "class-6" ? TO_CLASS : null)
      );
      const req = makeReq({ body: basePayload });
      const res = makeMockRes();

      await bulkPromote(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(prisma.student.findMany).not.toHaveBeenCalled();
    });

    it("returns 404 when the target class does not exist", async () => {
      (prisma.class.findUnique as jest.Mock).mockImplementation(({ where: { id } }: any) =>
        Promise.resolve(id === "class-5" ? FROM_CLASS : null)
      );
      const req = makeReq({ body: basePayload });
      const res = makeMockRes();

      await bulkPromote(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("returns 404 when the target section does not exist", async () => {
      (prisma.section.findUnique as jest.Mock).mockResolvedValue(null);
      const req = makeReq({ body: basePayload });
      const res = makeMockRes();

      await bulkPromote(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("DATA INTEGRITY: rejects when the target section does not belong to the target class", async () => {
      (prisma.section.findUnique as jest.Mock).mockResolvedValue({ ...TO_SECTION, classId: "class-OTHER" });
      const req = makeReq({ body: basePayload });
      const res = makeMockRes();

      await bulkPromote(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(prisma.student.findMany).not.toHaveBeenCalled();
    });
  });

  describe("SECURITY (IDOR fix)", () => {
    it("rejects when the source class belongs to a different branch than the caller", async () => {
      (prisma.class.findUnique as jest.Mock).mockImplementation(({ where: { id } }: any) =>
        Promise.resolve(id === "class-5" ? { ...FROM_CLASS, branchId: "branch-OTHER" } : TO_CLASS)
      );
      const req = makeReq({ body: basePayload });
      const res = makeMockRes();

      await bulkPromote(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(prisma.student.findMany).not.toHaveBeenCalled();
    });

    it("rejects when the target class belongs to a DIFFERENT branch than the source class (cross-branch promotion attempt)", async () => {
      (prisma.class.findUnique as jest.Mock).mockImplementation(({ where: { id } }: any) =>
        Promise.resolve(id === "class-5" ? FROM_CLASS : { ...TO_CLASS, branchId: "branch-OTHER" })
      );
      const req = makeReq({ body: basePayload });
      const res = makeMockRes();

      await bulkPromote(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(prisma.student.findMany).not.toHaveBeenCalled();
    });

    it("rejects when the target section belongs to a different branch", async () => {
      (prisma.section.findUnique as jest.Mock).mockResolvedValue({ ...TO_SECTION, branchId: "branch-OTHER" });
      const req = makeReq({ body: basePayload });
      const res = makeMockRes();

      await bulkPromote(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(prisma.student.findMany).not.toHaveBeenCalled();
    });

    it("SUPER_ADMIN can promote across any branch", async () => {
      (prisma.student.findMany as jest.Mock).mockResolvedValue([{ id: "s1" }]);
      const req = makeReq({
        body: basePayload,
        user: { userId: "super-1", email: "e", role: UserRole.SUPER_ADMIN },
      });
      const res = makeMockRes();

      await bulkPromote(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe("promotion logic", () => {
    it("returns a zero-result summary when no active students are found", async () => {
      (prisma.student.findMany as jest.Mock).mockResolvedValue([]);
      const req = makeReq({ body: basePayload });
      const res = makeMockRes();

      await bulkPromote(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ data: { promoted: 0, detained: 0, tcIssued: 0, total: 0 } })
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("scopes the student query to fromSectionId when provided", async () => {
      (prisma.student.findMany as jest.Mock).mockResolvedValue([]);
      const req = makeReq({ body: { ...basePayload, fromSectionId: "section-5a" } });
      const res = makeMockRes();

      await bulkPromote(req, res);

      expect(prisma.student.findMany).toHaveBeenCalledWith({
        where: { classId: "class-5", isActive: true, sectionId: "section-5a" },
        select: { id: true },
      });
    });

    it("promotes every student not listed as detained/tc-issued, in one bulk createMany + one bulk updateMany", async () => {
      (prisma.student.findMany as jest.Mock).mockResolvedValue([{ id: "s1" }, { id: "s2" }, { id: "s3" }]);
      const req = makeReq({ body: { ...basePayload, detainedStudentIds: ["s2"] } });
      const res = makeMockRes();

      await bulkPromote(req, res);

      const txCalls = (prisma.$transaction as jest.Mock).mock.calls[0][0];
      // Promotion.createMany for promoted (s1, s3)
      expect(prisma.promotion.createMany).toHaveBeenCalledWith({
        data: [
          { studentId: "s1", academicYearId: "year-1", fromClassId: "class-5", toClassId: "class-6", status: "PROMOTED" },
          { studentId: "s3", academicYearId: "year-1", fromClassId: "class-5", toClassId: "class-6", status: "PROMOTED" },
        ],
      });
      // Promotion.createMany for detained (s2)
      expect(prisma.promotion.createMany).toHaveBeenCalledWith({
        data: [{ studentId: "s2", academicYearId: "year-1", fromClassId: "class-5", toClassId: null, status: "DETAINED" }],
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ data: { promoted: 2, detained: 1, tcIssued: 0, total: 3 } })
      );
      expect(txCalls.length).toBeGreaterThan(0);
    });

    it("moves promoted students to toClassId/toSectionId via student.updateMany (not a per-student loop)", async () => {
      const studentUpdateMany = jest.fn();
      (prisma as any).student.updateMany = studentUpdateMany;
      (prisma.student.findMany as jest.Mock).mockResolvedValue([{ id: "s1" }, { id: "s2" }]);
      const req = makeReq({ body: basePayload });
      const res = makeMockRes();

      await bulkPromote(req, res);

      expect(studentUpdateMany).toHaveBeenCalledWith({
        where: { id: { in: ["s1", "s2"] } },
        data: { classId: "class-6", sectionId: "section-6a" },
      });
    });

    it("deactivates tc-issued students (sets isActive false + leavingDate/leavingReason) instead of moving them", async () => {
      const studentUpdateMany = jest.fn();
      (prisma as any).student.updateMany = studentUpdateMany;
      (prisma.student.findMany as jest.Mock).mockResolvedValue([{ id: "s1" }, { id: "s2" }]);
      const req = makeReq({ body: { ...basePayload, tcIssuedStudentIds: ["s2"] } });
      const res = makeMockRes();

      await bulkPromote(req, res);

      // One updateMany call for the promoted student(s1), one for the tc-issued student(s2)
      expect(studentUpdateMany).toHaveBeenCalledWith({
        where: { id: { in: ["s1"] } },
        data: { classId: "class-6", sectionId: "section-6a" },
      });
      expect(studentUpdateMany).toHaveBeenCalledWith({
        where: { id: { in: ["s2"] } },
        data: expect.objectContaining({ isActive: false, leavingReason: expect.any(String) }),
      });
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ data: { promoted: 1, detained: 0, tcIssued: 1, total: 2 } })
      );
    });

    it("a student appearing in BOTH detained and tc-issued lists is treated as tc-issued only (never double-processed)", async () => {
      (prisma.student.findMany as jest.Mock).mockResolvedValue([{ id: "s1" }]);
      const req = makeReq({
        body: { ...basePayload, detainedStudentIds: ["s1"], tcIssuedStudentIds: ["s1"] },
      });
      const res = makeMockRes();

      await bulkPromote(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ data: { promoted: 0, detained: 0, tcIssued: 1, total: 1 } })
      );
      // Only ONE Promotion.createMany call should have happened (for
      // the tc-issued bucket) - not a second one for "detained" too.
      expect(prisma.promotion.createMany).toHaveBeenCalledTimes(1);
      expect(prisma.promotion.createMany).toHaveBeenCalledWith({
        data: [{ studentId: "s1", academicYearId: "year-1", fromClassId: "class-5", toClassId: null, status: "TC_ISSUED" }],
      });
    });

    it("ignores a detained/tc-issued id that isn't actually among the fetched (in-scope) students", async () => {
      (prisma.student.findMany as jest.Mock).mockResolvedValue([{ id: "s1" }]);
      const req = makeReq({ body: { ...basePayload, detainedStudentIds: ["s-not-in-class"] } });
      const res = makeMockRes();

      await bulkPromote(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ data: { promoted: 1, detained: 0, tcIssued: 0, total: 1 } })
      );
    });
  });
});
