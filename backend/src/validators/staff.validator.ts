import { z } from "zod";

export const createStaffSchema = z.object({
  body: z.object({
    // Optional: the "Add Staff" form has no branch-picker - the
    // backend always resolves the effective branchId server-side (see
    // resolveEffectiveBranchId in utils/branchScope.ts).
    branchId: z.string().optional(),
    name: z.string().min(1, "Name is required"),
    email: z.string().email("Valid email required"),
    phone: z.string().optional(),
    password: z.string().min(6, "Password must be at least 6 characters").optional().or(z.literal("")),
    designation: z.string().min(1, "Designation is required"),
    department: z.string().min(1, "Department is required"),
    type: z.enum(["TEACHING", "NON_TEACHING"]).optional(),
    qualification: z.string().optional(),
    experience: z.string().optional(),
    joiningDate: z.coerce.date({ errorMap: () => ({ message: "Valid joiningDate is required" }) }),
    bankAccount: z.string().optional(),
    bankName: z.string().optional(),
    ifscCode: z.string().optional(),
    panNumber: z.string().optional(),
    aadharNumber: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    pincode: z.string().optional(),
    cardId: z.string().optional(),
    role: z.enum(["BRANCH_ADMIN", "TEACHER", "ACCOUNTANT", "LIBRARIAN", "TRANSPORT_MANAGER", "WARDEN", "STAFF"]).optional(),
  }),
});

export const updateStaffSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    phone: z.string().optional(),
    designation: z.string().optional(),
    department: z.string().optional(),
    type: z.enum(["TEACHING", "NON_TEACHING"]).optional(),
    qualification: z.string().optional(),
    experience: z.string().optional(),
    bankAccount: z.string().optional(),
    bankName: z.string().optional(),
    ifscCode: z.string().optional(),
    panNumber: z.string().optional(),
    aadharNumber: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    pincode: z.string().optional(),
    cardId: z.string().optional(),
    isActive: z.boolean().optional(),
    leavingDate: z.coerce.date().optional(),
  }),
});
