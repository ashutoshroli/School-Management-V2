import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { resolveBranchId, resolveEffectiveBranchId, canAccessBranch } from "../utils/branchScope";

/**
 * Staff-facing management for the public landing page's Gallery,
 * Requirements page, and Feedback inbox (spec Section 21). The
 * public-facing READ side of Gallery/Requirements and the public
 * WRITE side of Feedback live in publicPortal.controller.ts (mounted,
 * unauthenticated, at /api/public/...); this controller is the
 * staff-only authenticated counterpart.
 */

export const uploadGalleryImage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { title, imageUrl, category } = req.body;
    const branchId = resolveEffectiveBranchId(req, req.body.branchId);
    if (!branchId) { sendError(res, "Branch ID could not be resolved", 400); return; }
    if (!canAccessBranch(req, branchId)) { sendError(res, "Access denied", 403); return; }

    const image = await prisma.galleryImage.create({
      data: { branchId, title, imageUrl, category, uploadedBy: req.user!.userId },
    });
    sendSuccess(res, image, "Gallery image added", 201);
  } catch (error) { sendError(res, "Failed to add gallery image", 500, (error as Error).message); }
};

export const getGalleryImages = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    const images = await prisma.galleryImage.findMany({ where: { branchId }, orderBy: { createdAt: "desc" } });
    sendSuccess(res, images, "Gallery images fetched");
  } catch (error) { sendError(res, "Failed to fetch gallery images", 500, (error as Error).message); }
};

export const deleteGalleryImage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const image = await prisma.galleryImage.findUnique({ where: { id } });
    if (!image) { sendError(res, "Image not found", 404); return; }
    if (!canAccessBranch(req, image.branchId)) { sendError(res, "Image not found", 404); return; }

    await prisma.galleryImage.delete({ where: { id } });
    sendSuccess(res, null, "Gallery image deleted");
  } catch (error) { sendError(res, "Failed to delete gallery image", 500, (error as Error).message); }
};

export const upsertRequirementsPage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { content } = req.body;
    const branchId = resolveEffectiveBranchId(req, req.body.branchId);
    if (!branchId) { sendError(res, "Branch ID could not be resolved", 400); return; }
    if (!canAccessBranch(req, branchId)) { sendError(res, "Access denied", 403); return; }

    const page = await prisma.requirementsPage.upsert({
      where: { branchId },
      update: { content, updatedBy: req.user!.userId },
      create: { branchId, content, updatedBy: req.user!.userId },
    });
    sendSuccess(res, page, "Requirements page saved");
  } catch (error) { sendError(res, "Failed to save requirements page", 500, (error as Error).message); }
};

export const getRequirementsPageAdmin = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    if (!branchId) { sendError(res, "Branch ID required", 400); return; }
    const page = await prisma.requirementsPage.findUnique({ where: { branchId } });
    sendSuccess(res, page || { branchId, content: "" }, "Requirements page fetched");
  } catch (error) { sendError(res, "Failed to fetch requirements page", 500, (error as Error).message); }
};

export const getFeedbackList = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveBranchId(req);
    const feedback = await prisma.publicFeedback.findMany({ where: { branchId }, orderBy: { createdAt: "desc" } });
    sendSuccess(res, feedback, "Feedback fetched");
  } catch (error) { sendError(res, "Failed to fetch feedback", 500, (error as Error).message); }
};

export const reviewFeedback = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { reviewNotes } = req.body;

    const feedback = await prisma.publicFeedback.findUnique({ where: { id } });
    if (!feedback) { sendError(res, "Feedback not found", 404); return; }
    if (!canAccessBranch(req, feedback.branchId)) { sendError(res, "Feedback not found", 404); return; }

    const updated = await prisma.publicFeedback.update({
      where: { id },
      data: { reviewNotes, reviewedBy: req.user!.userId },
    });
    sendSuccess(res, updated, "Feedback reviewed");
  } catch (error) { sendError(res, "Failed to review feedback", 500, (error as Error).message); }
};
