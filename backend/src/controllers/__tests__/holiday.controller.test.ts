import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    holiday: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), delete: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { getHolidays, createHoliday, deleteHoliday } from "../holiday.controller";
import { AuthRequest } from "../../types";

const makeMockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const makeReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
  ({ body: {}, params: {}, query: {}, user: { userId: "admin-1", email: "a@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" }, ...overrides } as any);

describe("holiday.controller - getHolidays", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.holiday.findMany as jest.Mock).mockResolvedValue([]);
  });

  it("scopes to the caller's branch with no year filter by default", async () => {
    const req = makeReq({ query: {} });
    const res = makeMockRes();

    await getHolidays(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect((prisma.holiday.findMany as jest.Mock).mock.calls[0][0].where).toEqual({ branchId: "branch-1" });
  });

  it("filters to a specific year when provided", async () => {
    const req = makeReq({ query: { year: "2025" } });
    const res = makeMockRes();

    await getHolidays(req, res);

    const whereArg = (prisma.holiday.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.date).toEqual({ gte: new Date(2025, 0, 1), lte: new Date(2025, 11, 31, 23, 59, 59) });
  });
});

describe("holiday.controller - createHoliday", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.holiday.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.holiday.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "h1", ...data }));
  });

  it("falls back to the caller's own branch when the client sends an empty branchId", async () => {
    const req = makeReq({ body: { branchId: "", date: "2025-08-15", name: "Independence Day" } });
    const res = makeMockRes();

    await createHoliday(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect((prisma.holiday.create as jest.Mock).mock.calls[0][0].data.branchId).toBe("branch-1");
  });

  it("DATA INTEGRITY: rejects a duplicate holiday for the same date", async () => {
    (prisma.holiday.findUnique as jest.Mock).mockResolvedValue({ id: "existing" });
    const req = makeReq({ body: { date: "2025-08-15", name: "Independence Day" } });
    const res = makeMockRes();

    await createHoliday(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.holiday.create).not.toHaveBeenCalled();
  });

  it("SECURITY: silently neutralizes a Branch Admin trying to target a different branch", async () => {
    const req = makeReq({ body: { branchId: "branch-OTHER", date: "2025-08-15", name: "Independence Day" } });
    const res = makeMockRes();

    await createHoliday(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect((prisma.holiday.create as jest.Mock).mock.calls[0][0].data.branchId).toBe("branch-1");
  });
});

describe("holiday.controller - deleteHoliday", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 404 when the holiday does not exist", async () => {
    (prisma.holiday.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { id: "h1" } });
    const res = makeMockRes();

    await deleteHoliday(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects deleting a holiday belonging to a DIFFERENT branch", async () => {
    (prisma.holiday.findUnique as jest.Mock).mockResolvedValue({ id: "h1", branchId: "branch-OTHER" });
    const req = makeReq({ params: { id: "h1" } });
    const res = makeMockRes();

    await deleteHoliday(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.holiday.delete).not.toHaveBeenCalled();
  });

  it("deletes a holiday in the caller's own branch", async () => {
    (prisma.holiday.findUnique as jest.Mock).mockResolvedValue({ id: "h1", branchId: "branch-1" });
    const req = makeReq({ params: { id: "h1" } });
    const res = makeMockRes();

    await deleteHoliday(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.holiday.delete).toHaveBeenCalledWith({ where: { id: "h1" } });
  });
});
