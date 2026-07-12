import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    notice: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    staff: { findMany: jest.fn() },
    student: { findMany: jest.fn() },
    studentParent: { findMany: jest.fn() },
    notification: { createMany: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { createNotice, getNoticeById, getNotices, togglePublicVisibility } from "../notice.controller";
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

// Backend UX Gap Phase 3: getNotices previously had no search or
// date-range filter - only branch + type.
describe("notice.controller - getNotices (search + date-range filters)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.notice.findMany as jest.Mock).mockResolvedValue([]);
  });

  it("searches title/body when a search term is provided", async () => {
    const req = makeReq({ query: { search: "holiday" } });
    const res = makeMockRes();

    await getNotices(req, res);

    const whereArg = (prisma.notice.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.OR).toEqual([
      { title: { contains: "holiday", mode: "insensitive" } },
      { body: { contains: "holiday", mode: "insensitive" } },
    ]);
  });

  it("filters by a fromDate/toDate range on createdAt", async () => {
    const req = makeReq({ query: { fromDate: "2025-01-01", toDate: "2025-01-31" } });
    const res = makeMockRes();

    await getNotices(req, res);

    const whereArg = (prisma.notice.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.createdAt).toEqual({ gte: new Date("2025-01-01"), lte: new Date("2025-01-31") });
  });

  it("omits both filters when neither is provided", async () => {
    const req = makeReq({ query: {} });
    const res = makeMockRes();

    await getNotices(req, res);

    const whereArg = (prisma.notice.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.OR).toBeUndefined();
    expect(whereArg.createdAt).toBeUndefined();
  });
});

// New Features (Public Portal Phase 4): togglePublicVisibility opts a
// notice into the public (no-auth) notice board.
describe("notice.controller - togglePublicVisibility", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 404 when the notice does not exist", async () => {
    (prisma.notice.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { id: "notice-1" } });
    const res = makeMockRes();

    await togglePublicVisibility(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects a notice belonging to a DIFFERENT branch", async () => {
    (prisma.notice.findUnique as jest.Mock).mockResolvedValue({ id: "notice-1", branchId: "branch-OTHER", isPublic: false });
    const req = makeReq({ params: { id: "notice-1" } });
    const res = makeMockRes();

    await togglePublicVisibility(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("toggles isPublic from false to true", async () => {
    (prisma.notice.findUnique as jest.Mock).mockResolvedValue({ id: "notice-1", branchId: "branch-1", isPublic: false });
    (prisma.notice.update as jest.Mock).mockResolvedValue({ id: "notice-1", isPublic: true });
    const req = makeReq({ params: { id: "notice-1" } });
    const res = makeMockRes();

    await togglePublicVisibility(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.notice.update).toHaveBeenCalledWith({ where: { id: "notice-1" }, data: { isPublic: true } });
  });
});
