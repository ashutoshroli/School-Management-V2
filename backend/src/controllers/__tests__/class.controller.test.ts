import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    class: { findUnique: jest.fn(), create: jest.fn() },
    section: { findUnique: jest.fn(), create: jest.fn() },
    subject: { findUnique: jest.fn(), create: jest.fn() },
    staff: { findUnique: jest.fn() },
    subjectTeacher: { findUnique: jest.fn(), create: jest.fn(), findMany: jest.fn(), delete: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { createClass, createSection, createSubject, getSubjectById, assignSubjectTeacher, getSubjectTeachers, removeSubjectTeacher } from "../class.controller";
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

describe("class.controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createClass", () => {
    it("BUG FIX: falls back to the caller's own branch when the client sends an empty branchId", async () => {
      (prisma.class.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.class.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "class-1", ...data }));

      const req = makeReq({ body: { branchId: "", name: "Class 5", numericOrder: 5 } });
      const res = makeMockRes();

      await createClass(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect((prisma.class.create as jest.Mock).mock.calls[0][0].data.branchId).toBe("branch-1");
    });

    it("returns 400 when no branchId can be resolved", async () => {
      const req = makeReq({
        body: { branchId: "", name: "Class 5" },
        user: { userId: "u1", email: "e", role: UserRole.ACCOUNTANT, branchId: undefined },
      });
      const res = makeMockRes();

      await createClass(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(prisma.class.create).not.toHaveBeenCalled();
    });

    it("SECURITY: silently neutralizes a Branch Admin trying to target a different branch (creates under their own branch instead)", async () => {
      (prisma.class.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.class.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "class-1", ...data }));

      const req = makeReq({ body: { branchId: "branch-OTHER", name: "Class 5" } });
      const res = makeMockRes();

      await createClass(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect((prisma.class.create as jest.Mock).mock.calls[0][0].data.branchId).toBe("branch-1");
    });

    it("rejects a duplicate class name within the same branch", async () => {
      (prisma.class.findUnique as jest.Mock).mockResolvedValue({ id: "existing" });

      const req = makeReq({ body: { branchId: "", name: "Class 5" } });
      const res = makeMockRes();

      await createClass(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(prisma.class.create).not.toHaveBeenCalled();
    });
  });

  describe("createSection", () => {
    it("BUG FIX: falls back to the caller's own branch when the client sends an empty branchId", async () => {
      (prisma.section.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.section.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "sec-1", ...data }));

      const req = makeReq({ body: { branchId: "", classId: "class-1", name: "A", capacity: 40 } });
      const res = makeMockRes();

      await createSection(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect((prisma.section.create as jest.Mock).mock.calls[0][0].data.branchId).toBe("branch-1");
    });

    it("SECURITY: silently neutralizes a Branch Admin trying to target a different branch (creates under their own branch instead)", async () => {
      (prisma.section.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.section.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "sec-1", ...data }));

      const req = makeReq({ body: { branchId: "branch-OTHER", classId: "class-1", name: "A" } });
      const res = makeMockRes();

      await createSection(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect((prisma.section.create as jest.Mock).mock.calls[0][0].data.branchId).toBe("branch-1");
    });
  });

  describe("createSubject", () => {
    it("BUG FIX: falls back to the caller's own branch when the client sends an empty branchId", async () => {
      (prisma.subject.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.subject.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "subj-1", ...data }));

      const req = makeReq({ body: { branchId: "", name: "Mathematics", code: "MATH" } });
      const res = makeMockRes();

      await createSubject(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect((prisma.subject.create as jest.Mock).mock.calls[0][0].data.branchId).toBe("branch-1");
    });

    it("SECURITY: silently neutralizes a Branch Admin trying to target a different branch (creates under their own branch instead)", async () => {
      (prisma.subject.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.subject.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "subj-1", ...data }));

      const req = makeReq({ body: { branchId: "branch-OTHER", name: "Mathematics", code: "MATH" } });
      const res = makeMockRes();

      await createSubject(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect((prisma.subject.create as jest.Mock).mock.calls[0][0].data.branchId).toBe("branch-1");
    });
  });

  describe("getSubjectById", () => {
    it("returns 404 when the subject does not exist", async () => {
      (prisma.subject.findUnique as jest.Mock).mockResolvedValue(null);
      const req = makeReq({ params: { id: "subj-1" } });
      const res = makeMockRes();

      await getSubjectById(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("SECURITY: rejects a subject belonging to a DIFFERENT branch", async () => {
      (prisma.subject.findUnique as jest.Mock).mockResolvedValue({ id: "subj-1", branchId: "branch-OTHER", classSubjects: [], subjectTeachers: [] });
      const req = makeReq({ params: { id: "subj-1" } });
      const res = makeMockRes();

      await getSubjectById(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("returns the subject with its classes and teachers when in the caller's own branch", async () => {
      (prisma.subject.findUnique as jest.Mock).mockResolvedValue({
        id: "subj-1",
        branchId: "branch-1",
        name: "Mathematics",
        classSubjects: [{ class: { id: "class-1", name: "Class 5" } }],
        subjectTeachers: [{ staff: { user: { name: "Mrs. Sharma" } }, class: { id: "class-1", name: "Class 5" } }],
      });
      const req = makeReq({ params: { id: "subj-1" } });
      const res = makeMockRes();

      await getSubjectById(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const payload = (res.json as jest.Mock).mock.calls[0][0].data;
      expect(payload.classSubjects).toHaveLength(1);
      expect(payload.subjectTeachers).toHaveLength(1);
    });
  });

  describe("assignSubjectTeacher", () => {
    const STAFF = { id: "staff-1", branchId: "branch-1", user: { role: UserRole.TEACHER } };
    const SUBJECT = { id: "subj-1", branchId: "branch-1" };
    const CLASS = { id: "class-1", branchId: "branch-1" };

    beforeEach(() => {
      (prisma.staff.findUnique as jest.Mock).mockResolvedValue(STAFF);
      (prisma.subject.findUnique as jest.Mock).mockResolvedValue(SUBJECT);
      (prisma.class.findUnique as jest.Mock).mockResolvedValue(CLASS);
      (prisma.subjectTeacher.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.subjectTeacher.create as jest.Mock).mockImplementation(({ data }: any) =>
        Promise.resolve({ id: "st-1", ...data })
      );
    });

    it("returns 400 when staffId is missing", async () => {
      const req = makeReq({ body: { subjectId: "subj-1", classId: "class-1" } });
      const res = makeMockRes();

      await assignSubjectTeacher(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(prisma.staff.findUnique).not.toHaveBeenCalled();
    });

    it("returns 400 when subjectId is missing", async () => {
      const req = makeReq({ body: { staffId: "staff-1", classId: "class-1" } });
      const res = makeMockRes();

      await assignSubjectTeacher(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("returns 404 when the staff member does not exist", async () => {
      (prisma.staff.findUnique as jest.Mock).mockResolvedValue(null);
      const req = makeReq({ body: { staffId: "staff-1", subjectId: "subj-1", classId: "class-1" } });
      const res = makeMockRes();

      await assignSubjectTeacher(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(prisma.subjectTeacher.create).not.toHaveBeenCalled();
    });

    it("returns 404 when the subject does not exist", async () => {
      (prisma.subject.findUnique as jest.Mock).mockResolvedValue(null);
      const req = makeReq({ body: { staffId: "staff-1", subjectId: "subj-1", classId: "class-1" } });
      const res = makeMockRes();

      await assignSubjectTeacher(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("returns 404 when a given classId does not exist", async () => {
      (prisma.class.findUnique as jest.Mock).mockResolvedValue(null);
      const req = makeReq({ body: { staffId: "staff-1", subjectId: "subj-1", classId: "class-1" } });
      const res = makeMockRes();

      await assignSubjectTeacher(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("SECURITY: rejects when the staff, subject, and class don't all belong to the same branch", async () => {
      (prisma.subject.findUnique as jest.Mock).mockResolvedValue({ id: "subj-1", branchId: "branch-OTHER" });
      const req = makeReq({ body: { staffId: "staff-1", subjectId: "subj-1", classId: "class-1" } });
      const res = makeMockRes();

      await assignSubjectTeacher(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(prisma.subjectTeacher.create).not.toHaveBeenCalled();
    });

    it("SECURITY: rejects a Branch Admin whose own branch doesn't match the staff's branch", async () => {
      const req = makeReq({
        body: { staffId: "staff-1", subjectId: "subj-1", classId: "class-1" },
        user: { userId: "admin-2", email: "e", role: UserRole.BRANCH_ADMIN, branchId: "branch-OTHER" },
      });
      const res = makeMockRes();

      await assignSubjectTeacher(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(prisma.subjectTeacher.create).not.toHaveBeenCalled();
    });

    it("creates the assignment when everything is valid", async () => {
      const req = makeReq({ body: { staffId: "staff-1", subjectId: "subj-1", classId: "class-1" } });
      const res = makeMockRes();

      await assignSubjectTeacher(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(prisma.subjectTeacher.create).toHaveBeenCalledWith({
        data: { staffId: "staff-1", subjectId: "subj-1", classId: "class-1" },
      });
    });

    it("is idempotent - re-assigning the same teacher/subject/class combo is a no-op, not an error", async () => {
      (prisma.subjectTeacher.findUnique as jest.Mock).mockResolvedValue({ id: "st-existing" });
      const req = makeReq({ body: { staffId: "staff-1", subjectId: "subj-1", classId: "class-1" } });
      const res = makeMockRes();

      await assignSubjectTeacher(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(prisma.subjectTeacher.create).not.toHaveBeenCalled();
    });

    it("allows a null classId (subject-wide assignment, not tied to one class)", async () => {
      const req = makeReq({ body: { staffId: "staff-1", subjectId: "subj-1" } });
      const res = makeMockRes();

      await assignSubjectTeacher(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(prisma.class.findUnique).not.toHaveBeenCalled();
      expect(prisma.subjectTeacher.create).toHaveBeenCalledWith({
        data: { staffId: "staff-1", subjectId: "subj-1", classId: null },
      });
    });
  });

  describe("getSubjectTeachers", () => {
    it("fetches assignments filtered by classId when provided", async () => {
      (prisma.subjectTeacher.findMany as jest.Mock).mockResolvedValue([]);
      const req = makeReq({ query: { classId: "class-1" } });
      const res = makeMockRes();

      await getSubjectTeachers(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const whereArg = (prisma.subjectTeacher.findMany as jest.Mock).mock.calls[0][0].where;
      expect(whereArg.classId).toBe("class-1");
      expect(whereArg.subject).toEqual({ branchId: "branch-1" });
    });

    // Backend UX Gap Phase 3: no staffId/subjectId filter existed before.
    it("filters by staffId when provided", async () => {
      (prisma.subjectTeacher.findMany as jest.Mock).mockResolvedValue([]);
      const req = makeReq({ query: { staffId: "staff-1" } });
      const res = makeMockRes();

      await getSubjectTeachers(req, res);

      const whereArg = (prisma.subjectTeacher.findMany as jest.Mock).mock.calls[0][0].where;
      expect(whereArg.staffId).toBe("staff-1");
    });

    it("filters by subjectId when provided", async () => {
      (prisma.subjectTeacher.findMany as jest.Mock).mockResolvedValue([]);
      const req = makeReq({ query: { subjectId: "subj-1" } });
      const res = makeMockRes();

      await getSubjectTeachers(req, res);

      const whereArg = (prisma.subjectTeacher.findMany as jest.Mock).mock.calls[0][0].where;
      expect(whereArg.subjectId).toBe("subj-1");
    });
  });

  describe("removeSubjectTeacher", () => {
    it("returns 404 when the assignment does not exist", async () => {
      (prisma.subjectTeacher.findUnique as jest.Mock).mockResolvedValue(null);
      const req = makeReq({ params: { id: "st-1" } });
      const res = makeMockRes();

      await removeSubjectTeacher(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(prisma.subjectTeacher.delete).not.toHaveBeenCalled();
    });

    it("SECURITY: rejects removing an assignment belonging to a different branch", async () => {
      (prisma.subjectTeacher.findUnique as jest.Mock).mockResolvedValue({
        id: "st-1",
        subject: { branchId: "branch-OTHER" },
      });
      const req = makeReq({ params: { id: "st-1" } });
      const res = makeMockRes();

      await removeSubjectTeacher(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(prisma.subjectTeacher.delete).not.toHaveBeenCalled();
    });

    it("deletes the assignment when it belongs to the caller's branch", async () => {
      (prisma.subjectTeacher.findUnique as jest.Mock).mockResolvedValue({
        id: "st-1",
        subject: { branchId: "branch-1" },
      });
      const req = makeReq({ params: { id: "st-1" } });
      const res = makeMockRes();

      await removeSubjectTeacher(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(prisma.subjectTeacher.delete).toHaveBeenCalledWith({ where: { id: "st-1" } });
    });
  });
});
