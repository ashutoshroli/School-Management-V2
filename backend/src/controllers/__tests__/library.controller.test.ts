import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    libraryBook: { create: jest.fn(), findUnique: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { addBook, getBookById } from "../library.controller";
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

describe("library.controller - getBookById", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 404 when the book does not exist", async () => {
    (prisma.libraryBook.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { id: "book-1" } });
    const res = makeMockRes();

    await getBookById(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects a book belonging to a DIFFERENT branch", async () => {
    (prisma.libraryBook.findUnique as jest.Mock).mockResolvedValue({ id: "book-1", branchId: "branch-OTHER", issues: [] });
    const req = makeReq({ params: { id: "book-1" } });
    const res = makeMockRes();

    await getBookById(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns the book with its issue history when in the caller's own branch", async () => {
    (prisma.libraryBook.findUnique as jest.Mock).mockResolvedValue({
      id: "book-1",
      branchId: "branch-1",
      title: "The Alchemist",
      issues: [{ id: "issue-1", student: { user: { name: "Ravi" } } }],
    });
    const req = makeReq({ params: { id: "book-1" } });
    const res = makeMockRes();

    await getBookById(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(payload.issues).toHaveLength(1);
  });
});
