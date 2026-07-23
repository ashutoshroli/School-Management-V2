import { z } from "zod";

export const addBookSchema = z.object({
  body: z.object({
    // Optional - resolved server-side, see resolveEffectiveBranchId.
    branchId: z.string().optional(),
    title: z.string().min(1, "title is required"),
    author: z.string().min(1, "author is required"),
    isbn: z.string().optional(),
    publisher: z.string().optional(),
    category: z.string().optional(),
    rackNo: z.string().optional(),
    shelfNo: z.string().optional(),
    totalCopies: z.number().int().min(1).optional(),
    price: z.union([z.number(), z.string()]).transform((v) => Number(v)).optional(),
  }),
});

export const issueBookSchema = z.object({
  body: z.object({
    bookId: z.string().min(1, "bookId is required"),
    studentId: z.string().min(1, "studentId is required"),
    dueDate: z.coerce.date({ errorMap: () => ({ message: "Valid dueDate is required" }) }),
  }),
});

export const bulkIssueBookSchema = z.object({
  body: z.object({
    bookId: z.string().min(1, "bookId is required"),
    studentIds: z.array(z.string().min(1)).min(1, "studentIds must be a non-empty array"),
    dueDate: z.coerce.date({ errorMap: () => ({ message: "Valid dueDate is required" }) }),
  }),
});


export const issueBookToStaffSchema = z.object({
  body: z.object({
    bookId: z.string().min(1, "bookId is required"),
    staffId: z.string().min(1, "staffId is required"),
    dueDate: z.coerce.date({ errorMap: () => ({ message: "Valid dueDate is required" }) }),
  }),
});

export const markLostOrDamagedSchema = z.object({
  body: z.object({
    status: z.enum(["LOST", "DAMAGED"]),
    // "STUDENT" (default) -> LibraryIssue, "STAFF" -> StaffLibraryIssue.
    // See markLostOrDamaged's doc comment in the controller.
    issueType: z.enum(["STUDENT", "STAFF"]).optional(),
  }),
});

export const waiveLibraryCostSchema = z.object({
  body: z.object({
    waiveType: z.enum(["FINE", "LOST_DAMAGE"]),
    amount: z.union([z.number(), z.string()]).transform((v) => Number(v)),
    isPercent: z.boolean().optional(),
    issueType: z.enum(["STUDENT", "STAFF"]).optional(),
  }),
});

export const upsertLibraryConfigSchema = z.object({
  body: z.object({
    branchId: z.string().optional(),
    finePerDay: z.union([z.number(), z.string()]).transform((v) => Number(v)).optional(),
    lostDamageCostMode: z.enum(["FIXED", "PERCENTAGE"]).optional(),
    flatLostCost: z.union([z.number(), z.string()]).transform((v) => Number(v)).optional(),
    flatDamagedCost: z.union([z.number(), z.string()]).transform((v) => Number(v)).optional(),
    defaultLostCostPct: z.union([z.number(), z.string()]).transform((v) => Number(v)).optional(),
    defaultDamagedCostPct: z.union([z.number(), z.string()]).transform((v) => Number(v)).optional(),
    studentIssueLimit: z.number().int().min(1).optional(),
    staffIssueLimit: z.number().int().min(1).optional(),
  }),
});
