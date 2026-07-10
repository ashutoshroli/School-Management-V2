import { UserRole } from "@prisma/client";
import { resolveBranchId, canAccessBranch } from "../branchScope";
import { AuthRequest } from "../../types";

const makeReq = (overrides: Partial<AuthRequest["user"]> = {}, query: Record<string, string> = {}): AuthRequest =>
  ({
    user: {
      userId: "user-1",
      email: "test@example.com",
      role: UserRole.BRANCH_ADMIN,
      branchId: "branch-1",
      ...overrides,
    },
    query,
  } as unknown as AuthRequest);

describe("resolveBranchId", () => {
  it("returns the user's own branchId for non-SUPER_ADMIN roles", () => {
    const req = makeReq({ role: UserRole.BRANCH_ADMIN, branchId: "branch-1" });
    expect(resolveBranchId(req)).toBe("branch-1");
  });

  it("ignores a ?branchId= query param for non-SUPER_ADMIN roles (IDOR prevention)", () => {
    const req = makeReq({ role: UserRole.TEACHER, branchId: "branch-1" }, { branchId: "branch-2" });
    expect(resolveBranchId(req)).toBe("branch-1");
  });

  it("allows SUPER_ADMIN to override via ?branchId= query param", () => {
    const req = makeReq({ role: UserRole.SUPER_ADMIN, branchId: "branch-1" }, { branchId: "branch-2" });
    expect(resolveBranchId(req)).toBe("branch-2");
  });

  it("falls back to SUPER_ADMIN's own branchId if no query param given", () => {
    const req = makeReq({ role: UserRole.SUPER_ADMIN, branchId: "branch-1" });
    expect(resolveBranchId(req)).toBe("branch-1");
  });

  it("returns undefined if the user has no branchId and is not SUPER_ADMIN with an override", () => {
    const req = makeReq({ role: UserRole.ACCOUNTANT, branchId: undefined });
    expect(resolveBranchId(req)).toBeUndefined();
  });
});

describe("canAccessBranch", () => {
  it("allows SUPER_ADMIN to access any branch", () => {
    const req = makeReq({ role: UserRole.SUPER_ADMIN, branchId: "branch-1" });
    expect(canAccessBranch(req, "some-other-branch")).toBe(true);
  });

  it("allows a staff user to access their own branch's resource", () => {
    const req = makeReq({ role: UserRole.BRANCH_ADMIN, branchId: "branch-1" });
    expect(canAccessBranch(req, "branch-1")).toBe(true);
  });

  it("denies a staff user access to a different branch's resource (IDOR prevention)", () => {
    const req = makeReq({ role: UserRole.TEACHER, branchId: "branch-1" });
    expect(canAccessBranch(req, "branch-2")).toBe(false);
  });

  it("denies access when the resource has no branchId at all", () => {
    const req = makeReq({ role: UserRole.TEACHER, branchId: "branch-1" });
    expect(canAccessBranch(req, null)).toBe(false);
    expect(canAccessBranch(req, undefined)).toBe(false);
  });
});
