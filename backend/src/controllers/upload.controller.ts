import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { canAccessBranch } from "../utils/branchScope";
import { canAccessStudentRecord } from "../utils/studentAccess";
import { storage } from "../services/storage.service";

const DOCUMENT_TYPES = new Set(["photo", "birth_cert", "aadhar", "tc", "marksheet", "resume", "certificate", "pan"]);

/**
 * POST /api/students/:id/documents
 * Uploads a document for a student (photo, birth certificate, TC, etc)
 * and records it in StudentDocument. Field name: "file", plus a "type"
 * field in the multipart body.
 */
export const uploadStudentDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id: studentId } = req.params;
    const type = (req.body.type as string) || "photo";

    if (!req.file) {
      sendError(res, "No file uploaded (expected multipart field 'file')", 400);
      return;
    }
    if (!DOCUMENT_TYPES.has(type)) {
      sendError(res, `Invalid document type. Allowed: ${Array.from(DOCUMENT_TYPES).join(", ")}`, 400);
      return;
    }

    const student = await prisma.student.findUnique({ where: { id: studentId }, select: { branchId: true } });
    if (!student) {
      sendError(res, "Student not found", 404);
      return;
    }
    if (!canAccessBranch(req, student.branchId) && !(await canAccessStudentRecord(req, studentId))) {
      sendError(res, "Student not found", 404);
      return;
    }

    const { url } = await storage.save(req.file.buffer, req.file.originalname, `students/${studentId}`);

    const document = await prisma.studentDocument.create({
      data: { studentId, name: req.file.originalname, type, fileUrl: url },
    });

    sendSuccess(res, document, "Document uploaded", 201);
  } catch (error) {
    sendError(res, "Failed to upload document", 500, (error as Error).message);
  }
};

/**
 * DELETE /api/students/:studentId/documents/:docId
 */
export const deleteStudentDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { studentId, docId } = req.params;

    const student = await prisma.student.findUnique({ where: { id: studentId }, select: { branchId: true } });
    if (!student) { sendError(res, "Student not found", 404); return; }
    if (!canAccessBranch(req, student.branchId)) { sendError(res, "Student not found", 404); return; }

    const document = await prisma.studentDocument.findUnique({ where: { id: docId } });
    if (!document || document.studentId !== studentId) {
      sendError(res, "Document not found", 404);
      return;
    }

    await prisma.studentDocument.delete({ where: { id: docId } });
    await storage.deleteByUrl(document.fileUrl);

    sendSuccess(res, null, "Document deleted");
  } catch (error) {
    sendError(res, "Failed to delete document", 500, (error as Error).message);
  }
};

/**
 * POST /api/staff/:id/documents
 * Same as uploadStudentDocument but for staff (HR) documents.
 */
export const uploadStaffDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id: staffId } = req.params;
    const type = (req.body.type as string) || "certificate";

    if (!req.file) {
      sendError(res, "No file uploaded (expected multipart field 'file')", 400);
      return;
    }
    if (!DOCUMENT_TYPES.has(type)) {
      sendError(res, `Invalid document type. Allowed: ${Array.from(DOCUMENT_TYPES).join(", ")}`, 400);
      return;
    }

    const staff = await prisma.staff.findUnique({ where: { id: staffId }, select: { branchId: true } });
    if (!staff) {
      sendError(res, "Staff not found", 404);
      return;
    }
    if (!canAccessBranch(req, staff.branchId)) {
      sendError(res, "Staff not found", 404);
      return;
    }

    const { url } = await storage.save(req.file.buffer, req.file.originalname, `staff/${staffId}`);

    const document = await prisma.staffDocument.create({
      data: { staffId, name: req.file.originalname, type, fileUrl: url },
    });

    sendSuccess(res, document, "Document uploaded", 201);
  } catch (error) {
    sendError(res, "Failed to upload document", 500, (error as Error).message);
  }
};

/**
 * DELETE /api/staff/:staffId/documents/:docId
 */
export const deleteStaffDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { staffId, docId } = req.params;

    const staff = await prisma.staff.findUnique({ where: { id: staffId }, select: { branchId: true } });
    if (!staff) { sendError(res, "Staff not found", 404); return; }
    if (!canAccessBranch(req, staff.branchId)) { sendError(res, "Staff not found", 404); return; }

    const document = await prisma.staffDocument.findUnique({ where: { id: docId } });
    if (!document || document.staffId !== staffId) {
      sendError(res, "Document not found", 404);
      return;
    }

    await prisma.staffDocument.delete({ where: { id: docId } });
    await storage.deleteByUrl(document.fileUrl);

    sendSuccess(res, null, "Document deleted");
  } catch (error) {
    sendError(res, "Failed to delete document", 500, (error as Error).message);
  }
};

/**
 * POST /api/auth/avatar
 * Lets the currently logged-in user (any role) upload/replace their own
 * profile photo. This is the one upload endpoint that's purely
 * self-service - no branch/admin checks needed since it only ever
 * touches the caller's own User row.
 */
export const uploadOwnAvatar = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      sendError(res, "No file uploaded (expected multipart field 'file')", 400);
      return;
    }

    const existing = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { avatar: true } });

    const { url } = await storage.save(req.file.buffer, req.file.originalname, `avatars/${req.user!.userId}`);

    const user = await prisma.user.update({
      where: { id: req.user!.userId },
      data: { avatar: url },
      select: { id: true, name: true, email: true, avatar: true },
    });

    // Best-effort cleanup of the previous avatar file, if any.
    if (existing?.avatar) {
      await storage.deleteByUrl(existing.avatar).catch(() => undefined);
    }

    sendSuccess(res, user, "Avatar updated");
  } catch (error) {
    sendError(res, "Failed to upload avatar", 500, (error as Error).message);
  }
};
