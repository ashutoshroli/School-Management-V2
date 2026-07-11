import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    libraryBook: { create: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { addBook } from "../library.controller";
import { AuthRequest } from "../../types";

const makeMockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const baseBody = { title: "The Alchemist", author: "Paulo Coelho", totalCopies: 3 };

const makeReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
  ({
    body: { ...baseBody },
    params: {},
    query: {},
    user: { userId: "admin-1", email: "admin@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" },
    ...overrides,
  } as any);

describe("library.controller - addBook", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.libraryBook.create as jest.Mock).mockImplementation(({ data }: any) => Promise.resolve({ id: "book-1", ...data }));
  });

  it("BUG FIX: falls back to the caller's own branch when the client sends an empty branchId", async () => {
    const req = makeReq({ body: { ...baseBody, branchId: "" } });
    const res = makeMockRes();

    await addBook(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect((prisma.libraryBook.create as jest.Mock).mock.calls[0][0].data.branchId).toBe("branch-1");
  });

  it("returns 400 when no branchId can be resolved", async () => {
    const req = makeReq({
      body: { ...baseBody, branchId: "" },
      user: { userId: "u1", email: "e", role: UserRole.ACCOUNTANT, branchId: undefined },
    });
    const res = makeMockRes();

    await addBook(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.libraryBook.create).not.toHaveBeenCalled();
  });

  it("SECURITY: silently neutralizes a Branch Admin trying to target a different branch (creates under their own branch instead)", async () => {
    const req = makeReq({ body: { ...baseBody, branchId: "branch-OTHER" } });
    const res = makeMockRes();

    await addBook(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect((prisma.libraryBook.create as jest.Mock).mock.calls[0][0].data.branchId).toBe("branch-1");
  });
});
