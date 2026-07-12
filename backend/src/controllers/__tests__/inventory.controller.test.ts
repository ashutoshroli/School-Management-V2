import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    inventoryItem: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { addItem, getLowStockAlerts, getItemById, getItems } from "../inventory.controller";
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

  it("SECURITY: silently neutralizes a Branch Admin trying to target a different branch (creates under their own branch instead)", async () => {
    const req = makeReq({ body: { branchId: "branch-OTHER", name: "Notebooks", category: "stationery", unit: "pcs" } });
    const res = makeMockRes();

    await addItem(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect((prisma.inventoryItem.create as jest.Mock).mock.calls[0][0].data.branchId).toBe("branch-1");
  });
});


describe("inventory.controller - getLowStockAlerts", () => {
  const makeReqForBranch = (): AuthRequest =>
    ({
      body: {},
      params: {},
      query: {},
      user: { userId: "admin-1", email: "admin@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" },
    } as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("makes exactly ONE findMany call (no redundant duplicate query) and filters to items at or below minStock", async () => {
    (prisma.inventoryItem.findMany as jest.Mock).mockResolvedValue([
      { id: "i1", currentStock: 2, minStock: 5 },
      { id: "i2", currentStock: 10, minStock: 5 },
      { id: "i3", currentStock: 5, minStock: 5 },
    ]);
    const req = makeReqForBranch();
    const res = makeMockRes();

    await getLowStockAlerts(req, res);

    expect(prisma.inventoryItem.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.inventoryItem.findMany).toHaveBeenCalledWith({ where: { branchId: "branch-1" } });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: [{ id: "i1", currentStock: 2, minStock: 5 }, { id: "i3", currentStock: 5, minStock: 5 }] })
    );
  });

  it("returns an empty list when nothing is low on stock", async () => {
    (prisma.inventoryItem.findMany as jest.Mock).mockResolvedValue([{ id: "i1", currentStock: 20, minStock: 5 }]);
    const req = makeReqForBranch();
    const res = makeMockRes();

    await getLowStockAlerts(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: [] }));
  });
});

describe("inventory.controller - getItemById", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 404 when the item does not exist", async () => {
    (prisma.inventoryItem.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { id: "item-1" } });
    const res = makeMockRes();

    await getItemById(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects an item belonging to a DIFFERENT branch", async () => {
    (prisma.inventoryItem.findUnique as jest.Mock).mockResolvedValue({ id: "item-1", branchId: "branch-OTHER", purchases: [], issues: [] });
    const req = makeReq({ params: { id: "item-1" } });
    const res = makeMockRes();

    await getItemById(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns the item with its purchase/issue history when in the caller's own branch", async () => {
    (prisma.inventoryItem.findUnique as jest.Mock).mockResolvedValue({
      id: "item-1",
      branchId: "branch-1",
      name: "Notebooks",
      purchases: [{ id: "p1" }],
      issues: [{ id: "i1" }],
    });
    const req = makeReq({ params: { id: "item-1" } });
    const res = makeMockRes();

    await getItemById(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(payload.purchases).toHaveLength(1);
    expect(payload.issues).toHaveLength(1);
  });
});

// Backend UX Gap Phase 3: getItems previously had no filters at all
// (not even category).
describe("inventory.controller - getItems (category filter)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.inventoryItem.findMany as jest.Mock).mockResolvedValue([]);
  });

  it("filters by category when provided", async () => {
    const req = makeReq({ query: { category: "stationery" } });
    const res = makeMockRes();

    await getItems(req, res);

    const whereArg = (prisma.inventoryItem.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.category).toBe("stationery");
  });

  it("omits the category filter when not provided", async () => {
    const req = makeReq({ query: {} });
    const res = makeMockRes();

    await getItems(req, res);

    const whereArg = (prisma.inventoryItem.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.category).toBeUndefined();
    expect(whereArg.branchId).toBe("branch-1");
  });
});
