import { Request, Response, NextFunction } from "express";
import { sendError } from "../utils/response";

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
  console.error("Error:", err.message);

  if (err instanceof AppError) {
    sendError(res, err.message, err.statusCode);
    return;
  }

  // Prisma errors
  if (err.name === "PrismaClientKnownRequestError") {
    sendError(res, "Database error", 400, err.message);
    return;
  }

  // Default server error
  sendError(
    res,
    process.env.NODE_ENV === "development" ? err.message : "Internal server error",
    500
  );
};

export const notFoundHandler = (_req: Request, res: Response): void => {
  sendError(res, "Route not found", 404);
};
