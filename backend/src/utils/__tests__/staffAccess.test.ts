import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    staff: { findUnique: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { canAccessStaffRecord } from "../staffAccess";
import { AuthRequest } from "../../types";

const makeReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
  ({
    body: {},
    params: {},
    query: {},
    user: { userId: "user-1", email: "u@test.com", role: UserRole.TEACHER, branchId: "branch-1" },
    ...overrides,
  } as any);

describe("staffAccess - canAccessStaffRecord", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns false when there is no authenticated user", async () => {
    const req = makeReq({ user: undefined });
    expect(await canAccessStaffRecord(req, "staff-1")).toBe(false);
    expect(prisma.staff.findUnique).not.toHaveBeenCalled();
  });

  it("returns false when the staff record does not exist", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq();
    expect(await canAccessStaffRecord(req, "staff-missing")).toBe(false);
  });

  it("SUPER_ADMIN can access any staff record regardless of branch", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ branchId: "branch-OTHER", userId: "someone-else" });
    const req = makeReq({ user: { userId: "super-1", email: "s@test.com", role: UserRole.SUPER_ADMIN, branchId: "branch-1" } });
    expect(await canAccessStaffRecord(req, "staff-1")).toBe(true);
  });

  it("allows a branch-level staff member to access a staff record in their OWN branch", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ branchId: "branch-1", userId: "someone-else" });
    const req = makeReq({ user: { userId: "teacher-1", email: "t@test.com", role: UserRole.TEACHER, branchId: "branch-1" } });
    expect(await canAccessStaffRecord(req, "staff-1")).toBe(true);
  });

  it("SECURITY: rejects a branch-level staff member accessing a staff record in a DIFFERENT branch (unless it's their own record)", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ branchId: "branch-OTHER", userId: "someone-else" });
    const req = makeReq({ user: { userId: "teacher-1", email: "t@test.com", role: UserRole.TEACHER, branchId: "branch-1" } });
    expect(await canAccessStaffRecord(req, "staff-1")).toBe(false);
  });

  it("allows a staff member to access their OWN record even from a different branchId context", async () => {
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ branchId: "branch-OTHER", userId: "teacher-1" });
    const req = makeReq({ user: { userId: "teacher-1", email: "t@test.com", role: UserRole.TEACHER, branchId: "branch-1" } });
    expect(await canAccessStaffRecord(req, "staff-1")).toBe(true);
  });
});
