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

    // Fan out an IN_APP notification to everyone the notice targets.
    // Deliberately IN_APP-only (not email/SMS) for broadcast notices -
    // a branch can have thousands of students/parents, and blasting
    // real emails/SMS to all of them on every notice would be expensive
    // and is a different (opt-in, digest-style) feature than what's
    // being built here. IN_APP just means "a Notification row exists"
    // for the recipient to see in-app; it's cheap (a single createMany)
    // and doesn't touch any external provider.
    notifyNoticeRecipients(notice.id, branchId, type, targetClass, title, body).catch((err) =>
      console.error("Failed to fan out notice notifications:", err)
    );

    sendSuccess(res, notice, "Notice published", 201);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Creates IN_APP Notification rows for every user the notice targets.
 * Uses createMany (a single INSERT) rather than notify() per-recipient,
 * since notify() is designed for a handful of real-channel sends, not
 * bulk fan-out to potentially thousands of students/parents.
 */
async function notifyNoticeRecipients(
  noticeId: string,
  branchId: string,
  type: string,
  targetClass: string | null | undefined,
  title: string,
  body: string
) {
  let userIds: string[] = [];

  if (type === "TEACHERS" || type === "STAFF") {
    const staff = await prisma.staff.findMany({
      where: { branchId, ...(type === "TEACHERS" ? { type: "TEACHING" } : {}) },
      select: { userId: true },
    });
    userIds = staff.map((s) => s.userId);
  } else {
    // ALL / STUDENTS / PARENTS / CLASS_SPECIFIC all start from the
    // relevant student set, then optionally walk up to parents.
    const students = await prisma.student.findMany({
      where: { branchId, isActive: true, ...(targetClass ? { classId: targetClass } : {}) },
      select: { id: true, userId: true },
    });

    if (type === "PARENTS") {
      const links = await prisma.studentParent.findMany({
        where: { studentId: { in: students.map((s) => s.id) } },
        include: { parent: { select: { userId: true } } },
      });
      userIds = links.map((l) => l.parent.userId);
    } else if (type === "STUDENTS" || type === "CLASS_SPECIFIC") {
      userIds = students.map((s) => s.userId);
    } else {
      // ALL: students + their parents (+ could include staff, but kept
      // to the school-community audience most relevant to a notice).
      const links = await prisma.studentParent.findMany({
        where: { studentId: { in: students.map((s) => s.id) } },
        include: { parent: { select: { userId: true } } },
      });
      userIds = [...students.map((s) => s.userId), ...links.map((l) => l.parent.userId)];
    }
  }

  if (userIds.length === 0) return;

  await prisma.notification.createMany({
    data: userIds.map((userId) => ({
      userId,
      title,
      body,
      type: "NOTICE" as const,
      channel: "IN_APP" as const,
      status: "SENT" as const,
      sentAt: new Date(),
    })),
  });
}

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
