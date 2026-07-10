import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";

/**
 * Bulk promote students (year-end)
 */
export const bulkPromote = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { academicYearId, fromClassId, toClassId, toSectionId, failedStudentIds } = req.body;
    // failedStudentIds = students who should be detained (not promoted)

    const students = await prisma.student.findMany({
      where: { classId: fromClassId, isActive: true },
    });

    let promoted = 0, detained = 0;

    for (const student of students) {
      const isFailed = failedStudentIds?.includes(student.id);

      await prisma.promotion.create({
        data: {
          studentId: student.id,
          academicYearId,
          fromClassId,
          toClassId: isFailed ? null : toClassId,
          status: isFailed ? "DETAINED" : "PROMOTED",
        },
      });

      if (!isFailed && toClassId) {
        await prisma.student.update({
          where: { id: student.id },
          data: { classId: toClassId, sectionId: toSectionId || student.sectionId },
        });
        promoted++;
      } else {
        detained++;
      }
    }

    sendSuccess(res, { promoted, detained, total: students.length }, `Promotion done: ${promoted} promoted, ${detained} detained`);
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};
