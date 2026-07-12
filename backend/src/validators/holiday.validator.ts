import { z } from "zod";

export const createHolidaySchema = z.object({
  body: z.object({
    branchId: z.string().optional(),
    date: z.coerce.date({ errorMap: () => ({ message: "Valid date is required" }) }),
    name: z.string().min(1, "name is required"),
  }),
});
