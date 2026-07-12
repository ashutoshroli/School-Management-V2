import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    libraryBook: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), update: jest.fn() },
    libraryIssue: { findMany: jest.fn(), createMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

import prisma from "../../config/database";
import { addBook, getBookById, getBooks, getIssuedBooks, bulkIssueBook } from "../library.controller";
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

// Backend UX Gap Phase 3: getBooks previously had no category filter
// at all.
describe("library.controller - getBooks (category filter)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.libraryBook.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.libraryBook.count as jest.Mock).mockResolvedValue(0);
  });

  it("filters by category when provided", async () => {
    const req = makeReq({ query: { category: "Fiction" } });
    const res = makeMockRes();

    await getBooks(req, res);

    const whereArg = (prisma.libraryBook.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.category).toBe("Fiction");
  });

  it("omits the category filter when not provided", async () => {
    const req = makeReq({ query: {} });
    const res = makeMockRes();

    await getBooks(req, res);

    const whereArg = (prisma.libraryBook.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.category).toBeUndefined();
  });
});

// Backend UX Gap Phase 3: getIssuedBooks previously had no
// classId/studentId filter or "overdue only" toggle.
describe("library.controller - getIssuedBooks (classId/studentId/overdueOnly filters)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.libraryIssue.findMany as jest.Mock).mockResolvedValue([]);
  });

  it("filters by classId (via the student relation) when provided", async () => {
    const req = makeReq({ query: { classId: "class-1" } });
    const res = makeMockRes();

    await getIssuedBooks(req, res);

    const whereArg = (prisma.libraryIssue.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.student).toEqual({ classId: "class-1" });
  });

  it("filters by studentId when provided", async () => {
    const req = makeReq({ query: { studentId: "student-1" } });
    const res = makeMockRes();

    await getIssuedBooks(req, res);

    const whereArg = (prisma.libraryIssue.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.studentId).toBe("student-1");
  });

  it("filters to overdue-only (dueDate in the past) when overdueOnly=true", async () => {
    const req = makeReq({ query: { overdueOnly: "true" } });
    const res = makeMockRes();

    await getIssuedBooks(req, res);

    const whereArg = (prisma.libraryIssue.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.dueDate.lt).toBeInstanceOf(Date);
  });

  it("defaults to status=ISSUED with no dueDate filter when overdueOnly is not set", async () => {
    const req = makeReq({ query: {} });
    const res = makeMockRes();

    await getIssuedBooks(req, res);

    const whereArg = (prisma.libraryIssue.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.status).toBe("ISSUED");
    expect(whereArg.dueDate).toBeUndefined();
  });
});

// Backend UX Gap Phase 4: issueBook only ever handled one student at a
// time; bulkIssueBook is the "issue to a whole class at once" counterpart.
describe("library.controller - bulkIssueBook", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.$transaction as jest.Mock).mockImplementation((ops: any[]) => Promise.all(ops));
  });

  it("returns 404 when the book does not exist", async () => {
    (prisma.libraryBook.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ body: { bookId: "book-1", studentIds: ["s1"], dueDate: "2025-07-01" } });
    const res = makeMockRes();

    await bulkIssueBook(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects a book belonging to a DIFFERENT branch", async () => {
    (prisma.libraryBook.findUnique as jest.Mock).mockResolvedValue({ id: "book-1", branchId: "branch-OTHER", availableCopies: 5 });
    const req = makeReq({ body: { bookId: "book-1", studentIds: ["s1"], dueDate: "2025-07-01" } });
    const res = makeMockRes();

    await bulkIssueBook(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("issues to every student when enough copies are available", async () => {
    (prisma.libraryBook.findUnique as jest.Mock).mockResolvedValue({ id: "book-1", branchId: "branch-1", availableCopies: 5 });
    const req = makeReq({ body: { bookId: "book-1", studentIds: ["s1", "s2", "s3"], dueDate: "2025-07-01" } });
    const res = makeMockRes();

    await bulkIssueBook(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const payload = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(payload.issued).toBe(3);
    expect(payload.skipped).toBe(0);
  });

  it("DATA INTEGRITY: caps issuance at availableCopies and reports the rest as skipped", async () => {
    (prisma.libraryBook.findUnique as jest.Mock).mockResolvedValue({ id: "book-1", branchId: "branch-1", availableCopies: 2 });
    const req = makeReq({ body: { bookId: "book-1", studentIds: ["s1", "s2", "s3", "s4"], dueDate: "2025-07-01" } });
    const res = makeMockRes();

    await bulkIssueBook(req, res);

    const payload = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(payload.issued).toBe(2);
    expect(payload.skipped).toBe(2);
  });

  it("issues to nobody and reports 0/skipped=all when no copies are available", async () => {
    (prisma.libraryBook.findUnique as jest.Mock).mockResolvedValue({ id: "book-1", branchId: "branch-1", availableCopies: 0 });
    const req = makeReq({ body: { bookId: "book-1", studentIds: ["s1", "s2"], dueDate: "2025-07-01" } });
    const res = makeMockRes();

    await bulkIssueBook(req, res);

    const payload = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(payload.issued).toBe(0);
    expect(payload.skipped).toBe(2);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
