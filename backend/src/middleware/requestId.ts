import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

/**
 * Assigns a unique request ID to every incoming request.
 *
 * - If the client (or a reverse proxy like nginx/CloudFront) already set
 *   an X-Request-Id header, reuse it for end-to-end correlation.
 * - Otherwise generate a new UUIDv4.
 * - Attach to `req.id` for use in downstream middleware/controllers/
 *   services (especially logger calls), and echo it back in the response
 *   via the same header so the client can correlate requests with
 *   support tickets or log entries.
 */
export const requestId = (req: Request, res: Response, next: NextFunction): void => {
  const id = (req.headers["x-request-id"] as string) || randomUUID();
  (req as any).requestId = id;
  res.setHeader("X-Request-Id", id);
  next();
};
