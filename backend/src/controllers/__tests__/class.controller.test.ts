import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    class: { findUnique: jest.fn(), create: jest.fn() },
    section: { findUnique: jest.fn(), create: jest.fn() },
    subject: { findUnique: jest.fn(), create: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { createClass, createSection, createSubject } from "../class.controller";
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
});
