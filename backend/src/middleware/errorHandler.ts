import { Request, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { sendError } from "../utils/response";
import { config } from "../config";

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (
  err: Error | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  // Log full detail server-side regardless of environment; only the
  // response body is sanitized for the client.
  console.error("Error:", err);

  if (err instanceof AppError) {
    sendError(res, err.message, err.statusCode);
    return;
  }

  // Prisma errors - use `instanceof` (not a string comparison against
  // `err.name`) so this doesn't silently break if error classes are
  // renamed/minified. Prisma messages can include table/column/query
  // detail, so only surface them in development.
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    sendError(
      res,
      "Database error",
      400,
      config.nodeEnv === "development" ? err.message : undefined
    );
    return;
  }

  // Default server error - never leak the raw error message to the
  // client in non-development environments.
  sendError(
    res,
    config.nodeEnv === "development" ? err.message : "Internal server error",
    500
  );
};

export const notFoundHandler = (_req: Request, res: Response): void => {
  sendError(res, "Route not found", 404);
};
