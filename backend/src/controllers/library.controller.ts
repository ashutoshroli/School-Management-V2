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

    // Issue limit (spec Section 12 - "Students max 3 books at a time").
    const { studentIssueLimit } = await resolveLibraryConfig(book.branchId);
    const currentlyIssued = await prisma.libraryIssue.count({ where: { studentId, status: "ISSUED" } });
    if (currentlyIssued >= studentIssueLimit) {
      sendError(res, `This student already has ${currentlyIssued} book(s) issued (limit: ${studentIssueLimit})`, 400);
      return;
    }

    const issue = await prisma.libraryIssue.create({
      data: { bookId, studentId, dueDate: new Date(dueDate), status: "ISSUED" },
    });

    await prisma.libraryBook.update({ where: { id: bookId }, data: { availableCopies: { decrement: 1 } } });
    sendSuccess(res, issue, "Book issued", 201);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Staff book issue (spec Section 12 - "Staff max 10 books at a time")
 * - uses the parallel StaffLibraryIssue table (see its doc comment in
 * schema.prisma for why this isn't the same table as student issues).
 */
export const issueBookToStaff = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { bookId, staffId, dueDate } = req.body;

    const book = await prisma.libraryBook.findUnique({ where: { id: bookId } });
    if (!book || book.availableCopies <= 0) { sendError(res, "Book not available", 400); return; }
    if (!canAccessBranch(req, book.branchId)) { sendError(res, "Book not found", 404); return; }

    const { staffIssueLimit } = await resolveLibraryConfig(book.branchId);
    const currentlyIssued = await prisma.staffLibraryIssue.count({ where: { staffId, status: "ISSUED" } });
    if (currentlyIssued >= staffIssueLimit) {
      sendError(res, `This staff member already has ${currentlyIssued} book(s) issued (limit: ${staffIssueLimit})`, 400);
      return;
    }

    const issue = await prisma.staffLibraryIssue.create({
      data: { bookId, staffId, dueDate: new Date(dueDate), status: "ISSUED" },
    });
    await prisma.libraryBook.update({ where: { id: bookId }, data: { availableCopies: { decrement: 1 } } });
    sendSuccess(res, issue, "Book issued to staff", 201);
  } catch (error) { sendError(res, "Failed to issue book to staff", 500, (error as Error).message); }
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

    // Filter out any student already at their issue limit (spec
    // Section 12) before capping by available copies below.
    const { studentIssueLimit } = await resolveLibraryConfig(book.branchId);
    const issuedCounts = await prisma.libraryIssue.groupBy({
      by: ["studentId"],
      where: { studentId: { in: studentIds }, status: "ISSUED" },
      _count: { _all: true },
    });
    const issuedCountByStudent = new Map(issuedCounts.map((c) => [c.studentId, c._count._all]));
    const eligibleStudentIds = studentIds.filter((sid: string) => (issuedCountByStudent.get(sid) || 0) < studentIssueLimit);
    const overLimitCount = studentIds.length - eligibleStudentIds.length;

    const copiesToIssue = Math.min(book.availableCopies, eligibleStudentIds.length);
    if (copiesToIssue === 0) {
      sendSuccess(res, { issued: 0, skipped: studentIds.length, total: studentIds.length }, "No copies available to issue");
      return;
    }

    const issuedStudentIds = eligibleStudentIds.slice(0, copiesToIssue);
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
      { issued: copiesToIssue, skipped, overLimit: overLimitCount, total: studentIds.length },
      `Issued to ${copiesToIssue} student(s)` +
        (overLimitCount > 0 ? ` (${overLimitCount} skipped - already at issue limit)` : "") +
        (skipped - overLimitCount > 0 ? ` (${skipped - overLimitCount} skipped - not enough copies available)` : ""),
      201
    );
  } catch (error) {
    sendError(res, "Failed to bulk-issue book", 500, (error as Error).message);
  }
};

/**
 * Resolves the branch's LibraryConfig (fine-per-day, lost/damage cost
 * mode/defaults, issue limits) - falling back to the original
 * hardcoded defaults (Rs 2/day fine, no lost/damage cost, 3/10 issue
 * limits) when no LibraryConfig row exists yet for this branch (fully
 * backward compatible - see the model's doc comment in schema.prisma).
 */
const resolveLibraryConfig = async (branchId: string) => {
  const config = await prisma.libraryConfig.findUnique({ where: { branchId } });
  return {
    finePerDay: config ? Number(config.finePerDay) : 2,
    lostDamageCostMode: config?.lostDamageCostMode || "FIXED",
    flatLostCost: config ? Number(config.flatLostCost) : 0,
    flatDamagedCost: config ? Number(config.flatDamagedCost) : 0,
    defaultLostCostPct: config ? Number(config.defaultLostCostPct) : 0,
    defaultDamagedCostPct: config ? Number(config.defaultDamagedCostPct) : 0,
    studentIssueLimit: config?.studentIssueLimit ?? 3,
    staffIssueLimit: config?.staffIssueLimit ?? 10,
  };
};

export const getLibraryConfig = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    if (!branchId) { sendError(res, "Branch ID required", 400); return; }
    const config = await resolveLibraryConfig(branchId);
    sendSuccess(res, config, "Library config fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

export const upsertLibraryConfig = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveEffectiveBranchId(req, req.body.branchId);
    if (!branchId) { sendError(res, "Branch ID could not be resolved", 400); return; }
    if (!canAccessBranch(req, branchId)) { sendError(res, "Access denied", 403); return; }

    const { finePerDay, lostDamageCostMode, flatLostCost, flatDamagedCost, defaultLostCostPct, defaultDamagedCostPct, studentIssueLimit, staffIssueLimit } = req.body;

    const config = await prisma.libraryConfig.upsert({
      where: { branchId },
      update: { finePerDay, lostDamageCostMode, flatLostCost, flatDamagedCost, defaultLostCostPct, defaultDamagedCostPct, studentIssueLimit, staffIssueLimit },
      create: { branchId, finePerDay, lostDamageCostMode, flatLostCost, flatDamagedCost, defaultLostCostPct, defaultDamagedCostPct, studentIssueLimit, staffIssueLimit },
    });
    sendSuccess(res, config, "Library config saved");
  } catch (error) { sendError(res, "Failed to save library config", 500, (error as Error).message); }
};

export const returnBook = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const issue = await prisma.libraryIssue.findUnique({ where: { id }, include: { book: true } });
    if (!issue || issue.status !== "ISSUED") { sendError(res, "Invalid issue", 400); return; }

    const branchConfig = await resolveLibraryConfig(issue.book.branchId);

    // Calculate fine using the branch's configured (Director-set) rate
    // instead of the previous hardcoded "Rs 2/day" (spec Section 12).
    const now = new Date();
    let fine = 0;
    if (now > new Date(issue.dueDate)) {
      const daysLate = Math.ceil((now.getTime() - new Date(issue.dueDate).getTime()) / (1000 * 60 * 60 * 24));
      fine = daysLate * branchConfig.finePerDay;
    }

    await prisma.libraryIssue.update({ where: { id }, data: { returnDate: now, fine, status: "RETURNED" } });
    await prisma.libraryBook.update({ where: { id: issue.bookId }, data: { availableCopies: { increment: 1 } } });
    sendSuccess(res, { fine }, `Book returned${fine > 0 ? `. Fine: Rs ${fine}` : ""}`);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Marks a book copy LOST or DAMAGED (spec Section 12), computing the
 * lost/damage cost per the branch's configured mode - FIXED (flat
 * amount) or PERCENTAGE (book-wise custom %, falling back to the
 * branch's default %). Increments neither availableCopies nor
 * totalCopies back (a lost/damaged copy is gone, unlike a normal
 * return) - if the school buys a replacement, that's a fresh addBook/
 * totalCopies adjustment, not something this endpoint infers.
 */
export const markLostOrDamaged = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status } = req.body; // "LOST" | "DAMAGED"

    const issue = await prisma.libraryIssue.findUnique({ where: { id }, include: { book: true } });
    if (!issue || issue.status !== "ISSUED") { sendError(res, "Invalid issue", 400); return; }
    if (!canAccessBranch(req, issue.book.branchId)) { sendError(res, "Invalid issue", 400); return; }

    const branchConfig = await resolveLibraryConfig(issue.book.branchId);
    const bookRate = Number(issue.book.currentRate ?? issue.book.price ?? 0);

    let cost = 0;
    if (branchConfig.lostDamageCostMode === "PERCENTAGE") {
      const pct = status === "LOST"
        ? Number(issue.book.lostCostPct ?? branchConfig.defaultLostCostPct)
        : Number(issue.book.damagedCostPct ?? branchConfig.defaultDamagedCostPct);
      cost = (bookRate * pct) / 100;
    } else {
      cost = status === "LOST" ? branchConfig.flatLostCost : branchConfig.flatDamagedCost;
    }

    const updated = await prisma.libraryIssue.update({
      where: { id },
      data: { status, lostDamageCost: cost },
    });
    // A lost/damaged copy permanently reduces the book's total stock
    // (unlike a normal return, which just frees the copy back up).
    await prisma.libraryBook.update({ where: { id: issue.bookId }, data: { totalCopies: { decrement: 1 } } });

    sendSuccess(res, updated, `Book marked ${status.toLowerCase()}. Cost: Rs ${cost}`);
  } catch (error) { sendError(res, "Failed to mark lost/damaged", 500, (error as Error).message); }
};

/**
 * Principal waiver of a fine or lost/damage cost - full or partial,
 * custom amount or % (spec Section 12). Restricted at the route level
 * to PRINCIPAL/ADMIN roles.
 */
export const waiveLibraryCost = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { waiveType, amount, isPercent } = req.body; // waiveType: "FINE" | "LOST_DAMAGE"

    const issue = await prisma.libraryIssue.findUnique({ where: { id }, include: { book: true } });
    if (!issue) { sendError(res, "Issue not found", 404); return; }
    if (!canAccessBranch(req, issue.book.branchId)) { sendError(res, "Issue not found", 404); return; }

    const baseAmount = waiveType === "FINE" ? Number(issue.fine) : Number(issue.lostDamageCost);
    const waivedAmount = isPercent ? (baseAmount * Number(amount)) / 100 : Number(amount);
    const cappedWaiver = Math.min(waivedAmount, baseAmount);

    const updated = await prisma.libraryIssue.update({
      where: { id },
      data: waiveType === "FINE"
        ? { fineWaivedAmount: cappedWaiver, fineWaivedBy: req.user!.userId }
        : { lostDamageCostWaived: cappedWaiver, lostDamageCostWaivedBy: req.user!.userId },
    });
    sendSuccess(res, updated, `Waived Rs ${cappedWaiver}`);
  } catch (error) { sendError(res, "Failed to waive cost", 500, (error as Error).message); }
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
