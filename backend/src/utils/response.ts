import { Response } from "express";
import { ApiResponse } from "../types";
import { config } from "../config";

export const sendSuccess = <T>(
  res: Response,
  data: T,
  message: string = "Success",
  statusCode: number = 200
) => {
  const response: ApiResponse<T> = {
    success: true,
    message,
    data,
  };
  return res.status(statusCode).json(response);
};

/**
 * SECURITY: `error` is only intended to hold safe, user-facing detail
 * (e.g. Zod validation messages). Controllers throughout the codebase
 * pass raw `(error as Error).message` here for unexpected/500-level
 * failures, which can leak Prisma internals, file paths, or other
 * implementation details to API clients.
 *
 * To avoid having to audit every call site individually, we strip the
 * `error` detail for 5xx responses whenever NODE_ENV is not
 * "development" - 4xx responses (validation, not-found, forbidden, etc.)
 * are left untouched since those are expected to carry safe messages.
 */
export const sendError = (
  res: Response,
  message: string = "Something went wrong",
  statusCode: number = 500,
  error?: string
) => {
  const exposeDetail = config.nodeEnv === "development" || statusCode < 500;
  const response: ApiResponse = {
    success: false,
    message,
    error: exposeDetail ? error : undefined,
  };
  return res.status(statusCode).json(response);
};

export const sendPaginated = <T>(
  res: Response,
  data: T[],
  total: number,
  page: number,
  limit: number,
  message: string = "Success"
) => {
  const response: ApiResponse<T[]> = {
    success: true,
    message,
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
  return res.status(200).json(response);
};
