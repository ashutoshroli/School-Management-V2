import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { resolveBranchId, canAccessBranch } from "../utils/branchScope";

export const createNotice = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { branchId, title, body, type, targetClass, attachmentUrl, isPinned, expiryDate } = req.body;
    if (!canAccessBranch(req, branchId)) { sendError(res, "Access denied: branch mismatch", 403); return; }
    const notice = await prisma.notice.create({
      data: { branchId, title, body, type, targetClass, attachmentUrl, isPinned: isPinned || false, expiryDate: expiryDate ? new Date(expiryDate) : null, publishedBy: req.user!.userId },
    });
    sendSuccess(res, notice, "Notice published", 201);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

export const getNotices = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    const type = req.query.type as string;

    const where: any = { branchId };
    if (type) where.type = type;

    const notices = await prisma.notice.findMany({
      where, orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
    });
    sendSuccess(res, notices, "Notices fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

export const deleteNotice = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const notice = await prisma.notice.findUnique({ where: { id } });
    if (!notice) { sendError(res, "Not found", 404); return; }
    if (!canAccessBranch(req, notice.branchId)) { sendError(res, "Not found", 404); return; }
    await prisma.notice.delete({ where: { id } });
    sendSuccess(res, null, "Notice deleted");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

export const togglePin = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const notice = await prisma.notice.findUnique({ where: { id } });
    if (!notice) { sendError(res, "Not found", 404); return; }
    if (!canAccessBranch(req, notice.branchId)) { sendError(res, "Not found", 404); return; }
    const updated = await prisma.notice.update({ where: { id }, data: { isPinned: !notice.isPinned } });
    sendSuccess(res, updated, `Notice ${updated.isPinned ? "pinned" : "unpinned"}`);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};
