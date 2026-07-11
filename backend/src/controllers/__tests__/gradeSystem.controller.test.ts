import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    gradeSystem: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { getGradeBands, createGradeBand, updateGradeBand, deleteGradeBand } from "../gradeSystem.controller";
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

describe("gradeSystem.controller - getGradeBands", () => {
  it("lists bands ordered by minMarks ascending", async () => {
    (prisma.gradeSystem.findMany as jest.Mock).mockResolvedValue([{ id: "g1", grade: "A+" }]);
    const req = makeReq();
    const res = makeMockRes();

    await getGradeBands(req, res);

    expect(prisma.gradeSystem.findMany).toHaveBeenCalledWith({ orderBy: { minMarks: "asc" } });
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe("gradeSystem.controller - createGradeBand", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.gradeSystem.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.gradeSystem.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "g1", ...data }));
  });

  it("creates a band when the range does not overlap any existing band", async () => {
    const req = makeReq({ body: { name: "CBSE", minMarks: 91, maxMarks: 100, grade: "A1", gradePoint: 10 } });
    const res = makeMockRes();

    await createGradeBand(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(prisma.gradeSystem.create).toHaveBeenCalled();
  });

  it("DATA INTEGRITY: rejects a range that overlaps an existing band", async () => {
    (prisma.gradeSystem.findFirst as jest.Mock).mockResolvedValue({ id: "existing", grade: "A", minMarks: 80, maxMarks: 90 });
    const req = makeReq({ body: { name: "CBSE", minMarks: 85, maxMarks: 95, grade: "A1" } });
    const res = makeMockRes();

    await createGradeBand(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.gradeSystem.create).not.toHaveBeenCalled();
  });
});

describe("gradeSystem.controller - updateGradeBand", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.gradeSystem.findUnique as jest.Mock).mockResolvedValue({ id: "g1", name: "CBSE", minMarks: 80, maxMarks: 90, grade: "A", gradePoint: 8 });
    (prisma.gradeSystem.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.gradeSystem.update as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "g1", ...data }));
  });

  it("returns 404 for a nonexistent band", async () => {
    (prisma.gradeSystem.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { id: "missing" }, body: { grade: "A1" } });
    const res = makeMockRes();

    await updateGradeBand(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("DATA INTEGRITY: rejects an updated range that would overlap a DIFFERENT band, excluding itself", async () => {
    (prisma.gradeSystem.findFirst as jest.Mock).mockResolvedValue({ id: "other", grade: "B", minMarks: 70, maxMarks: 80 });
    const req = makeReq({ params: { id: "g1" }, body: { minMarks: 75, maxMarks: 90 } });
    const res = makeMockRes();

    await updateGradeBand(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect((prisma.gradeSystem.findFirst as jest.Mock).mock.calls[0][0].where.id).toEqual({ not: "g1" });
    expect(prisma.gradeSystem.update).not.toHaveBeenCalled();
  });

  it("allows updating fields unrelated to the range without re-checking overlap", async () => {
    const req = makeReq({ params: { id: "g1" }, body: { name: "Updated Name" } });
    const res = makeMockRes();

    await updateGradeBand(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.gradeSystem.findFirst).not.toHaveBeenCalled();
  });
});

describe("gradeSystem.controller - deleteGradeBand", () => {
  it("deletes an existing band", async () => {
    (prisma.gradeSystem.findUnique as jest.Mock).mockResolvedValue({ id: "g1" });
    (prisma.gradeSystem.delete as jest.Mock).mockResolvedValue({});
    const req = makeReq({ params: { id: "g1" } });
    const res = makeMockRes();

    await deleteGradeBand(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.gradeSystem.delete).toHaveBeenCalledWith({ where: { id: "g1" } });
  });

  it("returns 404 for a nonexistent band", async () => {
    (prisma.gradeSystem.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { id: "missing" } });
    const res = makeMockRes();

    await deleteGradeBand(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.gradeSystem.delete).not.toHaveBeenCalled();
  });
});
