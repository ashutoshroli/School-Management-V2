import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError, sendPaginated } from "../utils/response";
import { resolveBranchId, resolveEffectiveBranchId, canAccessBranch } from "../utils/branchScope";

export const addBook = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { title, author, isbn, publisher, category, rackNo, shelfNo, totalCopies, price } = req.body;
    // BUG FIX + SECURITY: the "Add Book" form has no branch-picker, so
    // req.body.branchId always arrived as "" - see
    // resolveEffectiveBranchId's doc comment. Also adds the
    // canAccessBranch check this endpoint was previously missing
    // entirely.
    const branchId = resolveEffectiveBranchId(req, req.body.branchId);

    if (!branchId) {
      sendError(res, "Branch ID could not be resolved - please select a branch", 400);
      return;
    }
    if (!canAccessBranch(req, branchId)) {
      sendError(res, "Access denied: branch mismatch", 403);
      return;
    }

    const book = await prisma.libraryBook.create({
      data: { branchId, title, author, isbn, publisher, category, rackNo, shelfNo, totalCopies: totalCopies || 1, availableCopies: totalCopies || 1, price },
    });
    sendSuccess(res, book, "Book added", 201);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Get single book detail, with its full issue history (current +
 * past, most recent first) - the list view (getBooks) only returns
 * stock counts, with no way to see who currently has a copy or the
 * book's issue/return track record.
 */
export const getBookById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const book = await prisma.libraryBook.findUnique({
      where: { id },
      include: {
        issues: {
          include: { student: { include: { user: { select: { name: true } }, class: { select: { name: true } } } } },
          orderBy: { issueDate: "desc" },
        },
      },
    });
    if (!book) { sendError(res, "Book not found", 404); return; }
    if (!canAccessBranch(req, book.branchId)) { sendError(res, "Book not found", 404); return; }

    sendSuccess(res, book, "Book fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

export const getBooks = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    const search = req.query.search as string;
    const category = req.query.category as string;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 25;
    const skip = (page - 1) * limit;

    const where: any = { branchId };
    if (category) where.category = category;
    if (search) { where.OR = [{ title: { contains: search, mode: "insensitive" } }, { author: { contains: search, mode: "insensitive" } }, { isbn: { contains: search, mode: "insensitive" } }]; }

    const [books, total] = await Promise.all([
      prisma.libraryBook.findMany({ where, skip, take: limit, orderBy: { title: "asc" } }),
      prisma.libraryBook.count({ where }),
    ]);
    sendPaginated(res, books, total, page, limit, "Books fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

export const issueBook = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { bookId, studentId, dueDate } = req.body;

    const book = await prisma.libraryBook.findUnique({ where: { id: bookId } });
    if (!book || book.availableCopies <= 0) { sendError(res, "Book not available", 400); return; }

    const issue = await prisma.libraryIssue.create({
      data: { bookId, studentId, dueDate: new Date(dueDate), status: "ISSUED" },
    });

    await prisma.libraryBook.update({ where: { id: bookId }, data: { availableCopies: { decrement: 1 } } });
    sendSuccess(res, issue, "Book issued", 201);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Issue one book to a whole hand-picked list of students at once
 * (e.g. handing out the same textbook to an entire class) - the bulk
 * counterpart to issueBook above. Each issue still needs its own row
 * (different studentId) and the book's availableCopies must be
 * decremented exactly once per issue, so this can't collapse into a
 * single createMany the way e.g. bulkPromote's Student.updateMany
 * does (those all write IDENTICAL data; these do not).
 *
 * Capped at whatever `availableCopies` actually allows: if fewer
 * copies are available than requested student count, only that many
 * students (in the order given) get a copy, and the rest are reported
 * as skipped - the librarian gets an honest count instead of a
 * confusing partial-failure error mid-way through.
 */
export const bulkIssueBook = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { bookId, studentIds, dueDate } = req.body;

    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      sendError(res, "studentIds must be a non-empty array", 400);
      return;
    }

    const book = await prisma.libraryBook.findUnique({ where: { id: bookId } });
    if (!book) { sendError(res, "Book not found", 404); return; }
    if (!canAccessBranch(req, book.branchId)) { sendError(res, "Book not found", 404); return; }

    const copiesToIssue = Math.min(book.availableCopies, studentIds.length);
    if (copiesToIssue === 0) {
      sendSuccess(res, { issued: 0, skipped: studentIds.length, total: studentIds.length }, "No copies available to issue");
      return;
    }

    const issuedStudentIds = studentIds.slice(0, copiesToIssue);
    const due = new Date(dueDate);

    await prisma.$transaction([
      prisma.libraryIssue.createMany({
        data: issuedStudentIds.map((studentId: string) => ({ bookId, studentId, dueDate: due, status: "ISSUED" as const })),
      }),
      prisma.libraryBook.update({ where: { id: bookId }, data: { availableCopies: { decrement: copiesToIssue } } }),
    ]);

    const skipped = studentIds.length - copiesToIssue;
    sendSuccess(
      res,
      { issued: copiesToIssue, skipped, total: studentIds.length },
      `Issued to ${copiesToIssue} student(s)` + (skipped > 0 ? ` (${skipped} skipped - not enough copies available)` : ""),
      201
    );
  } catch (error) {
    sendError(res, "Failed to bulk-issue book", 500, (error as Error).message);
  }
};

export const returnBook = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const issue = await prisma.libraryIssue.findUnique({ where: { id } });
    if (!issue || issue.status !== "ISSUED") { sendError(res, "Invalid issue", 400); return; }

    // Calculate fine
    const now = new Date();
    let fine = 0;
    if (now > new Date(issue.dueDate)) {
      const daysLate = Math.ceil((now.getTime() - new Date(issue.dueDate).getTime()) / (1000 * 60 * 60 * 24));
      fine = daysLate * 2; // Rs 2/day
    }

    await prisma.libraryIssue.update({ where: { id }, data: { returnDate: now, fine, status: "RETURNED" } });
    await prisma.libraryBook.update({ where: { id: issue.bookId }, data: { availableCopies: { increment: 1 } } });
    sendSuccess(res, { fine }, `Book returned${fine > 0 ? `. Fine: Rs ${fine}` : ""}`);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Delete a library book. Blocked if any copies are currently issued
 * (return them first) so stock/availability bookkeeping never breaks.
 */
export const deleteBook = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const book = await prisma.libraryBook.findUnique({ where: { id } });
    if (!book) { sendError(res, "Book not found", 404); return; }
    if (!canAccessBranch(req, book.branchId)) { sendError(res, "Book not found", 404); return; }

    const activeIssueCount = await prisma.libraryIssue.count({ where: { bookId: id, status: "ISSUED" } });
    if (activeIssueCount > 0) {
      sendError(res, `Cannot delete: ${activeIssueCount} copy/copies of this book are currently issued. Return them first.`, 400);
      return;
    }

    await prisma.libraryIssue.deleteMany({ where: { bookId: id } });
    await prisma.libraryBook.delete({ where: { id } });
    sendSuccess(res, null, "Book deleted");
  } catch (error) { sendError(res, "Failed to delete book", 500, (error as Error).message); }
};

export const getIssuedBooks = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const status = req.query.status as string || "ISSUED";
    const branchId = resolveBranchId(req);
    const classId = req.query.classId as string | undefined;
    const studentId = req.query.studentId as string | undefined;
    // "Overdue only" - still-ISSUED copies whose dueDate has already
    // passed. Only meaningful combined with status=ISSUED (a RETURNED
    // copy is never "overdue" regardless of how late it came back), so
    // this is intentionally independent of the `status` param above
    // rather than trying to redefine what status=OVERDUE would mean.
    const overdueOnly = req.query.overdueOnly === "true";

    const where: any = { status: status as any, book: { branchId } };
    if (classId) where.student = { classId };
    if (studentId) where.studentId = studentId;
    if (overdueOnly) where.dueDate = { lt: new Date() };

    const issues = await prisma.libraryIssue.findMany({
      where,
      include: { book: { select: { title: true, author: true } }, student: { include: { user: { select: { name: true } }, class: { select: { name: true } } } } },
      orderBy: { issueDate: "desc" },
    });
    sendSuccess(res, issues, "Issued books fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};
