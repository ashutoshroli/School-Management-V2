import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    inventoryItem: { create: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { addItem } from "../inventory.controller";
import { AuthRequest } from "../../types";

const makeMockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const makeReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
  ({
    body: { name: "Notebooks", category: "stationery", unit: "pcs" },
    params: {},
    query: {},
    user: { userId: "admin-1", email: "admin@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" },
    ...overrides,
  } as any);

describe("inventory.controller - addItem", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.inventoryItem.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "item-1", ...data }));
  });

  it("BUG FIX: falls back to the caller's own branch when the client sends an empty branchId", async () => {
    const req = makeReq({ body: { branchId: "", name: "Notebooks", category: "stationery", unit: "pcs" } });
    const res = makeMockRes();

    await addItem(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect((prisma.inventoryItem.create as jest.Mock).mock.calls[0][0].data.branchId).toBe("branch-1");
  });

  it("returns 400 when no branchId can be resolved", async () => {
    const req = makeReq({
      body: { branchId: "", name: "Notebooks" },
      user: { userId: "u1", email: "e", role: UserRole.ACCOUNTANT, branchId: undefined },
    });
    const res = makeMockRes();

    await addItem(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.inventoryItem.create).not.toHaveBeenCalled();
  });

  it("SECURITY: rejects a Branch Admin explicitly targeting a different branch (previously had NO check at all)", async () => {
    const req = makeReq({ body: { branchId: "branch-OTHER", name: "Notebooks" } });
    const res = makeMockRes();

    await addItem(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.inventoryItem.create).not.toHaveBeenCalled();
  });
});
