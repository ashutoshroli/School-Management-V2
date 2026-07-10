import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";

/**
 * Assign discount to student
 */
export const assignDiscount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { studentId, type, name, value, isPercent } = req.body;

    const discount = await prisma.studentDiscount.create({
      data: { studentId, type, name, value, isPercent: isPercent || false, isActive: true },
    });

    sendSuccess(res, discount, "Discount assigned", 201);
  } catch (error) {
    sendError(res, "Failed to assign discount", 500, (error as Error).message);
  }
};

/**
 * Get student's discounts
 */
export const getStudentDiscounts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { studentId } = req.params;

    const discounts = await prisma.studentDiscount.findMany({
      where: { studentId },
      orderBy: { createdAt: "desc" },
    });

    sendSuccess(res, discounts, "Discounts fetched");
  } catch (error) {
    sendError(res, "Failed to fetch discounts", 500, (error as Error).message);
  }
};

/**
 * Toggle discount active/inactive
 */
export const toggleDiscount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const discount = await prisma.studentDiscount.findUnique({ where: { id } });
    if (!discount) { sendError(res, "Discount not found", 404); return; }

    const updated = await prisma.studentDiscount.update({
      where: { id },
      data: { isActive: !discount.isActive },
    });

    sendSuccess(res, updated, `Discount ${updated.isActive ? "activated" : "deactivated"}`);
  } catch (error) {
    sendError(res, "Failed to toggle discount", 500, (error as Error).message);
  }
};

/**
 * Delete discount
 */
export const deleteDiscount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    await prisma.studentDiscount.delete({ where: { id } });
    sendSuccess(res, null, "Discount removed");
  } catch (error) {
    sendError(res, "Failed to delete discount", 500, (error as Error).message);
  }
};
