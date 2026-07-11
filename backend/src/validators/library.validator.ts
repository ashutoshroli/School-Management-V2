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
