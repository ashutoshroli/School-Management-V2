import multer from "multer";
import { Request, Response, NextFunction } from "express";
import { config } from "../config";
import { sendError } from "../utils/response";

// Documents (photo/ID proofs etc) vs avatars have different allowed
// types - documents may reasonably be a scanned PDF, avatars must be an
// image (they get rendered inline, e.g. on the ID card / profile UI).
const DOCUMENT_MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "application/pdf",
]);
const AVATAR_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

// Certificate/document templates are always Word (.docx) files - this
// is the standard OOXML MIME type. Some browsers/OSes report a generic
// "application/octet-stream" for .docx instead of the correct type, so
// the route-level file-extension check in template.controller.ts backs
// this up (multer's fileFilter only sees the MIME type, not the bytes).
const DOCX_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/octet-stream",
]);

// Exam question papers may be either a scanned/typed PDF or a Word
// (.docx) file - unlike DOCUMENT_MIME_TYPES (which is images + PDF,
// for student/staff document proofs) or DOCX_MIME_TYPES (Word-only,
// for certificate/receipt templates), this is the union of the two
// since a question paper is never an image scan-as-photo but IS
// commonly typed directly in Word.
const EXAM_PAPER_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/octet-stream",
]);

const memoryStorage = multer.memoryStorage();

const fileFilterFor = (allowed: Set<string>) => (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  if (allowed.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${file.mimetype}`));
  }
};

/** Single-file upload middleware for student/staff documents (field name: "file"). */
export const uploadDocument = multer({
  storage: memoryStorage,
  limits: { fileSize: config.upload.maxSize },
  fileFilter: fileFilterFor(DOCUMENT_MIME_TYPES),
}).single("file");

/** Single-file upload middleware for avatars/photos (field name: "file"). */
export const uploadAvatar = multer({
  storage: memoryStorage,
  limits: { fileSize: config.upload.maxSize },
  fileFilter: fileFilterFor(AVATAR_MIME_TYPES),
}).single("file");

/** Single-file upload middleware for DOCX certificate/document templates (field name: "file"). */
export const uploadTemplate = multer({
  storage: memoryStorage,
  limits: { fileSize: config.upload.maxSize },
  fileFilter: fileFilterFor(DOCX_MIME_TYPES),
}).single("file");

/** Single-file upload middleware for exam question papers, PDF or DOCX (field name: "file"). */
export const uploadExamPaper = multer({
  storage: memoryStorage,
  limits: { fileSize: config.upload.maxSize },
  fileFilter: fileFilterFor(EXAM_PAPER_MIME_TYPES),
}).single("file");

type MulterSingleMiddleware = (req: Request, res: Response, callback: (err: unknown) => void) => void;

/**
 * Wraps a multer middleware (the result of `.single("file")`) so its
 * errors (file too large, wrong type, missing file, etc) go through our
 * standard sendError() JSON shape instead of multer's default behaviour
 * of calling next(err) with a raw MulterError that would otherwise fall
 * through to the generic error handler with a less specific message.
 */
export const handleUploadErrors = (uploadMiddleware: MulterSingleMiddleware) => {
  return (req: Request, res: Response, next: NextFunction) => {
    uploadMiddleware(req, res, (err: unknown) => {
      if (!err) {
        next();
        return;
      }
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          sendError(res, `File too large. Maximum size is ${Math.round(config.upload.maxSize / (1024 * 1024))}MB`, 400);
          return;
        }
        sendError(res, `Upload error: ${err.message}`, 400);
        return;
      }
      sendError(res, (err as Error).message || "Upload failed", 400);
    });
  };
};
