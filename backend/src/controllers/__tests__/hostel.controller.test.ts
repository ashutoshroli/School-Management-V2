import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    hostelBuilding: { create: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { createBuilding } from "../hostel.controller";
import { AuthRequest } from "../../types";

const makeMockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const makeReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
  ({
    body: { name: "Boys Hostel", type: "BOYS" },
    params: {},
    query: {},
    user: { userId: "admin-1", email: "admin@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" },
    ...overrides,
  } as any);

describe("hostel.controller - createBuilding", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.hostelBuilding.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "building-1", ...data }));
  });

  it("BUG FIX: falls back to the caller's own branch when the client sends an empty branchId", async () => {
    const req = makeReq({ body: { branchId: "", name: "Boys Hostel", type: "BOYS" } });
    const res = makeMockRes();

    await createBuilding(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect((prisma.hostelBuilding.create as jest.Mock).mock.calls[0][0].data.branchId).toBe("branch-1");
  });

  it("returns 400 when no branchId can be resolved", async () => {
    const req = makeReq({
      body: { branchId: "", name: "Boys Hostel" },
      user: { userId: "u1", email: "e", role: UserRole.ACCOUNTANT, branchId: undefined },
    });
    const res = makeMockRes();

    await createBuilding(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.hostelBuilding.create).not.toHaveBeenCalled();
  });

  it("SECURITY: silently neutralizes a Branch Admin trying to target a different branch (creates under their own branch instead)", async () => {
    const req = makeReq({ body: { branchId: "branch-OTHER", name: "Boys Hostel", type: "BOYS" } });
    const res = makeMockRes();

    await createBuilding(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect((prisma.hostelBuilding.create as jest.Mock).mock.calls[0][0].data.branchId).toBe("branch-1");
  });
});
