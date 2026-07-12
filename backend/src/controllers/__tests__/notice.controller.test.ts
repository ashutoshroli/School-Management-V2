import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    notice: { create: jest.fn(), findUnique: jest.fn() },
    staff: { findMany: jest.fn() },
    student: { findMany: jest.fn() },
    studentParent: { findMany: jest.fn() },
    notification: { createMany: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { createNotice, getNoticeById } from "../notice.controller";
import { AuthRequest } from "../../types";

const makeMockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const baseBody = { title: "Holiday Notice", body: "School closed tomorrow", type: "ALL" };

const makeReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
  ({
    body: { ...baseBody },
    params: {},
    query: {},
    user: { userId: "admin-1", email: "admin@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" },
    ...overrides,
  } as any);

describe("notice.controller - createNotice", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.notice.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "notice-1", ...data }));
    (prisma.student.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.studentParent.findMany as jest.Mock).mockResolvedValue([]);
  });

  it("BUG FIX: falls back to the caller's own branch when the client sends an empty branchId", async () => {
    const req = makeReq({ body: { ...baseBody, branchId: "" } });
    const res = makeMockRes();

    await createNotice(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect((prisma.notice.create as jest.Mock).mock.calls[0][0].data.branchId).toBe("branch-1");
  });

  it("returns 400 when no branchId can be resolved", async () => {
    const req = makeReq({
      body: { ...baseBody, branchId: "" },
      user: { userId: "u1", email: "e", role: UserRole.ACCOUNTANT, branchId: undefined },
    });
    const res = makeMockRes();

    await createNotice(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.notice.create).not.toHaveBeenCalled();
  });

  it("SECURITY: silently neutralizes a Branch Admin trying to target a different branch (creates under their own branch instead)", async () => {
    const req = makeReq({ body: { ...baseBody, branchId: "branch-OTHER" } });
    const res = makeMockRes();

    await createNotice(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect((prisma.notice.create as jest.Mock).mock.calls[0][0].data.branchId).toBe("branch-1");
  });
});

describe("notice.controller - getNoticeById", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 404 when the notice does not exist", async () => {
    (prisma.notice.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { id: "notice-1" } });
    const res = makeMockRes();

    await getNoticeById(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects a notice belonging to a DIFFERENT branch", async () => {
    (prisma.notice.findUnique as jest.Mock).mockResolvedValue({ id: "notice-1", branchId: "branch-OTHER" });
    const req = makeReq({ params: { id: "notice-1" } });
    const res = makeMockRes();

    await getNoticeById(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns the notice when it belongs to the caller's own branch", async () => {
    (prisma.notice.findUnique as jest.Mock).mockResolvedValue({ id: "notice-1", branchId: "branch-1", title: "Holiday" });
    const req = makeReq({ params: { id: "notice-1" } });
    const res = makeMockRes();

    await getNoticeById(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });
});
