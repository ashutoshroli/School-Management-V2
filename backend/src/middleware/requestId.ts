import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

/**
 * Assigns a unique request ID to every incoming request for distributed
 * tracing / log correlation. Honors incoming X-Request-Id header from
 * proxies, echoes back in response.
 */
export const requestId = (req: Request, res: Response, next: NextFunction): void => {
  const id = (req.headers["x-request-id"] as string) || randomUUID();
  (req as any).requestId = id;
  res.setHeader("X-Request-Id", id);
  next();
};
