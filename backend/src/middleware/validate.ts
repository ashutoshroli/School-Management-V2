import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";
import { sendError } from "../utils/response";

/**
 * Validation middleware using Zod schemas
 * Usage: validate(createStudentSchema)
 */
export const validate = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      // Apply the parsed (and possibly transformed/coerced) result back
      // onto the request - schemas that use z.coerce or .transform()
      // (e.g. turning a string amount into a number) need their output
      // to actually reach the controller, not just validate the input.
      const parsed = schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      }) as { body?: unknown; query?: unknown; params?: unknown };

      if (parsed.body !== undefined) req.body = parsed.body;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.errors.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        }));
        sendError(res, "Validation failed", 400, JSON.stringify(errors));
        return;
      }
      next(error);
    }
  };
};
