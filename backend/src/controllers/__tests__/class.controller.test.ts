import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    class: { findUnique: jest.fn(), create: jest.fn(), findMany: jest.fn() },
    section: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    subject: { findUnique: jest.fn(), create: jest.fn() },
    staff: { findUnique: jest.fn() },
    subjectTeacher: { findUnique: jest.fn(), create: jest.fn(), findMany: jest.fn(), delete: jest.fn() },
    classSubject: { findMany: jest.fn(), createMany: jest.fn() },
    schoolRoom: { findUnique: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { createClass, createSection, updateSection, createSubject, getSubjectById, getClassSubjectMatrix, bulkAssignSubjectToClass, assignSubjectTeacher, getSubjectTeachers, removeSubjectTeacher } from "../class.controller";
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

    it("links the section to a classroom room in the same branch", async () => {
      (prisma.section.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.schoolRoom.findUnique as jest.Mock).mockResolvedValue({ id: "room-1", floor: { building: { branchId: "branch-1" } } });
      (prisma.section.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "sec-1", ...data }));

      const req = makeReq({ body: { branchId: "", classId: "class-1", name: "A", roomId: "room-1" } });
      const res = makeMockRes();

      await createSection(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect((prisma.section.create as jest.Mock).mock.calls[0][0].data.roomId).toBe("room-1");
    });

    it("SECURITY: rejects linking a section to a room in a DIFFERENT branch", async () => {
      (prisma.section.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.schoolRoom.findUnique as jest.Mock).mockResolvedValue({ id: "room-1", floor: { building: { branchId: "branch-OTHER" } } });

      const req = makeReq({ body: { branchId: "", classId: "class-1", name: "A", roomId: "room-1" } });
      const res = makeMockRes();

      await createSection(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(prisma.section.create).not.toHaveBeenCalled();
    });
  });

  describe("updateSection - roomId", () => {
    beforeEach(() => {
      (prisma.section.findUnique as jest.Mock).mockResolvedValue({ id: "sec-1", branchId: "branch-1" });
      (prisma.section.update as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "sec-1", branchId: "branch-1", ...data }));
    });

    it("links a section to a room in the same branch", async () => {
      (prisma.schoolRoom.findUnique as jest.Mock).mockResolvedValue({ id: "room-1", floor: { building: { branchId: "branch-1" } } });
      const req = makeReq({ params: { id: "sec-1" }, body: { roomId: "room-1" } });
      const res = makeMockRes();

      await updateSection(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect((prisma.section.update as jest.Mock).mock.calls[0][0].data.roomId).toBe("room-1");
    });

    it("SECURITY: rejects linking to a room in a DIFFERENT branch", async () => {
      (prisma.schoolRoom.findUnique as jest.Mock).mockResolvedValue({ id: "room-1", floor: { building: { branchId: "branch-OTHER" } } });
      const req = makeReq({ params: { id: "sec-1" }, body: { roomId: "room-1" } });
      const res = makeMockRes();

      await updateSection(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(prisma.section.update).not.toHaveBeenCalled();
    });

    it("clears the room link when roomId is explicitly set to an empty string", async () => {
      const req = makeReq({ params: { id: "sec-1" }, body: { roomId: "" } });
      const res = makeMockRes();

      await updateSection(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect((prisma.section.update as jest.Mock).mock.calls[0][0].data.roomId).toBeNull();
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

  // New Features Phase 2: combined "who teaches what, in which
  // section/room" view - previously only obtainable via two separate
  // calls (getClassSubjects + getSubjectTeachers) joined client-side.
  describe("getClassSubjectMatrix", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("returns 404 when the class does not exist", async () => {
      (prisma.class.findUnique as jest.Mock).mockResolvedValue(null);
      const req = makeReq({ params: { classId: "class-1" } });
      const res = makeMockRes();

      await getClassSubjectMatrix(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("SECURITY: rejects a class belonging to a DIFFERENT branch", async () => {
      (prisma.class.findUnique as jest.Mock).mockResolvedValue({ id: "class-1", branchId: "branch-OTHER", sections: [] });
      const req = makeReq({ params: { classId: "class-1" } });
      const res = makeMockRes();

      await getClassSubjectMatrix(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("returns the sections and a subject->teacher matrix, distinguishing class-specific vs school-wide default teachers", async () => {
      (prisma.class.findUnique as jest.Mock).mockResolvedValue({
        id: "class-1", name: "Class 5", branchId: "branch-1",
        sections: [{ id: "sec-1", name: "A", classTeacher: null, room: null, _count: { students: 30 } }],
      });
      (prisma.classSubject.findMany as jest.Mock).mockResolvedValue([
        { subjectId: "sub-1", subject: { id: "sub-1", name: "Maths" } },
      ]);
      (prisma.subjectTeacher.findMany as jest.Mock).mockResolvedValue([
        { id: "st-1", staffId: "staff-1", subjectId: "sub-1", classId: "class-1", staff: { id: "staff-1", user: { name: "Mrs. Sharma" } } },
        { id: "st-2", staffId: "staff-2", subjectId: "sub-1", classId: null, staff: { id: "staff-2", user: { name: "Mr. Verma" } } },
      ]);
      const req = makeReq({ params: { classId: "class-1" } });
      const res = makeMockRes();

      await getClassSubjectMatrix(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const payload = (res.json as jest.Mock).mock.calls[0][0].data;
      expect(payload.sections).toHaveLength(1);
      expect(payload.subjects).toHaveLength(1);
      expect(payload.subjects[0].teachers).toEqual([
        { assignmentId: "st-1", staffId: "staff-1", staffName: "Mrs. Sharma", classSpecific: true },
        { assignmentId: "st-2", staffId: "staff-2", staffName: "Mr. Verma", classSpecific: false },
      ]);
    });

    it("returns an empty subjects array (no extra query) when the class has no subjects assigned yet", async () => {
      (prisma.class.findUnique as jest.Mock).mockResolvedValue({ id: "class-1", branchId: "branch-1", sections: [] });
      (prisma.classSubject.findMany as jest.Mock).mockResolvedValue([]);
      const req = makeReq({ params: { classId: "class-1" } });
      const res = makeMockRes();

      await getClassSubjectMatrix(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(prisma.subjectTeacher.findMany).not.toHaveBeenCalled();
      const payload = (res.json as jest.Mock).mock.calls[0][0].data;
      expect(payload.subjects).toEqual([]);
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

  // Backend UX Gap Phase 4: assignSubjectToClass only ever handled one
  // class at a time; bulkAssignSubjectToClass is the "one subject for
  // Classes 6-10 in one call" counterpart.
  describe("bulkAssignSubjectToClass", () => {
    const SUBJECT = { id: "subj-1", branchId: "branch-1" };

    beforeEach(() => {
      (prisma.subject.findUnique as jest.Mock).mockResolvedValue(SUBJECT);
      (prisma.class.findMany as jest.Mock).mockResolvedValue([
        { id: "class-1", branchId: "branch-1" },
        { id: "class-2", branchId: "branch-1" },
      ]);
      (prisma.classSubject.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.classSubject.createMany as jest.Mock).mockResolvedValue({ count: 2 });
    });

    it("returns 404 when the subject does not exist", async () => {
      (prisma.subject.findUnique as jest.Mock).mockResolvedValue(null);
      const req = makeReq({ body: { subjectId: "subj-1", classIds: ["class-1"] } });
      const res = makeMockRes();

      await bulkAssignSubjectToClass(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(prisma.classSubject.createMany).not.toHaveBeenCalled();
    });

    it("SECURITY: rejects a subject belonging to a DIFFERENT branch", async () => {
      (prisma.subject.findUnique as jest.Mock).mockResolvedValue({ id: "subj-1", branchId: "branch-OTHER" });
      const req = makeReq({ body: { subjectId: "subj-1", classIds: ["class-1"] } });
      const res = makeMockRes();

      await bulkAssignSubjectToClass(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("DATA INTEGRITY: rejects when a target class belongs to a DIFFERENT branch than the subject", async () => {
      (prisma.class.findMany as jest.Mock).mockResolvedValue([{ id: "class-1", branchId: "branch-OTHER" }]);
      const req = makeReq({ body: { subjectId: "subj-1", classIds: ["class-1"] } });
      const res = makeMockRes();

      await bulkAssignSubjectToClass(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(prisma.classSubject.createMany).not.toHaveBeenCalled();
    });

    it("assigns the subject to every target class not already having it", async () => {
      const req = makeReq({ body: { subjectId: "subj-1", classIds: ["class-1", "class-2"] } });
      const res = makeMockRes();

      await bulkAssignSubjectToClass(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(prisma.classSubject.createMany).toHaveBeenCalledWith({
        data: [{ classId: "class-1", subjectId: "subj-1" }, { classId: "class-2", subjectId: "subj-1" }],
      });
    });

    it("skips classes that already have this subject assigned", async () => {
      (prisma.classSubject.findMany as jest.Mock).mockResolvedValue([{ classId: "class-1" }]);
      const req = makeReq({ body: { subjectId: "subj-1", classIds: ["class-1", "class-2"] } });
      const res = makeMockRes();

      await bulkAssignSubjectToClass(req, res);

      expect(prisma.classSubject.createMany).toHaveBeenCalledWith({
        data: [{ classId: "class-2", subjectId: "subj-1" }],
      });
      const payload = (res.json as jest.Mock).mock.calls[0][0].data;
      expect(payload.assigned).toBe(1);
      expect(payload.skipped).toBe(1);
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
