import prisma from "../config/database";
import { AuthRequest } from "../types";

export type AuditAction = "CREATE" | "UPDATE" | "DELETE";

export interface LogAuditParams {
  userId: string;
  action: AuditAction;
  module: string;
  entityId: string;
  oldData?: unknown;
  newData?: unknown;
  ipAddress?: string | null;
}

/**
 * Records an entry in the AuditLog table. Fire-and-forget by design -
 * failing to write an audit record must never fail (or roll back) the
 * actual mutation it's describing, so callers should not `await` this
 * inline with the primary write's error handling; errors are logged and
 * swallowed here.
 */
export const logAudit = async (params: LogAuditParams): Promise<void> => {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        module: params.module,
        entityId: params.entityId,
        oldData: params.oldData === undefined ? undefined : (params.oldData as any),
        newData: params.newData === undefined ? undefined : (params.newData as any),
        ipAddress: params.ipAddress || undefined,
      },
    });
  } catch (error) {
    console.error("Failed to write audit log:", error);
  }
};

/** Convenience wrapper that pulls userId/IP off an AuthRequest. */
export const logAuditFromRequest = (
  req: AuthRequest,
  action: AuditAction,
  module: string,
  entityId: string,
  data: { oldData?: unknown; newData?: unknown }
): void => {
  if (!req.user?.userId) return;
  // Deliberately not awaited by callers (see logAudit's doc comment) -
  // this wrapper itself doesn't await either, so a slow audit write
  // never delays the HTTP response.
  void logAudit({
    userId: req.user.userId,
    action,
    module,
    entityId,
    ipAddress: req.ip,
    ...data,
  });
};
