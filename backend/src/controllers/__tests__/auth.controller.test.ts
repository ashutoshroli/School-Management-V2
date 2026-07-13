import { UserRole } from "@prisma/client";

jest.mock("../../utils/jwt", () => ({
  generateToken: jest.fn().mockReturnValue("new-jwt-token"),
  generateTokenPair: jest.fn().mockReturnValue({ accessToken: "new-jwt-token", refreshToken: "refresh-token" }),
  verifyToken: jest.fn(),
}));

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    branch: { findUnique: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { generateToken } from "../../utils/jwt";
import { switchBranch } from "../auth.controller";
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
    user: { userId: "super-1", email: "super@test.com", role: UserRole.SUPER_ADMIN, organizationId: "org-1", branchId: "branch-1" },
    ...overrides,
  } as any);

describe("auth.controller - switchBranch", () => {
  beforeEach(() => jest.clearAllMocks());

  it("re-issues a token with the new branchId for a Super Admin", async () => {
    (prisma.branch.findUnique as jest.Mock).mockResolvedValue({ id: "branch-2", name: "North Campus" });

    const req = makeReq({ body: { branchId: "branch-2" } });
    const res = makeMockRes();

    await switchBranch(req, res);

    expect(generateToken).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "super-1", branchId: "branch-2" })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ accessToken: "new-jwt-token", branchId: "branch-2", branchName: "North Campus" }),
      })
    );
  });

  it("SECURITY: rejects a non-Super-Admin trying to switch branches", async () => {
    const req = makeReq({
      body: { branchId: "branch-2" },
      user: { userId: "admin-1", email: "admin@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" },
    });
    const res = makeMockRes();

    await switchBranch(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(generateToken).not.toHaveBeenCalled();
  });

  it("returns 400 when branchId is missing from the request", async () => {
    const req = makeReq({ body: {} });
    const res = makeMockRes();

    await switchBranch(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(generateToken).not.toHaveBeenCalled();
  });

  it("returns 404 when the target branch does not exist", async () => {
    (prisma.branch.findUnique as jest.Mock).mockResolvedValue(null);

    const req = makeReq({ body: { branchId: "does-not-exist" } });
    const res = makeMockRes();

    await switchBranch(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(generateToken).not.toHaveBeenCalled();
  });
});
