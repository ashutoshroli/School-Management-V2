import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError, sendPaginated } from "../utils/response";
import { resolveEffectiveBranchId } from "../utils/branchScope";

/**
 * POST /academics/discipline - Report a discipline incident
 */
export const reportIncident = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveEffectiveBranchId(req);
    const { studentId, incidentDate, severity, category, description, witnesses } = req.body;

    const incident = await prisma.disciplineIncident.create({
      data: {
        branchId,
        studentId,
        reportedBy: req.user!.userId,
        incidentDate: new Date(incidentDate),
        severity,
        category,
        description,
        witnesses,
      },
    });

    sendSuccess(res, incident, "Incident reported", 201);
  } catch (error) {
    sendError(res, "Failed to report incident", 500, (error as Error).message);
  }
};

/**
 * GET /academics/discipline - List discipline incidents
 */
export const getIncidents = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveEffectiveBranchId(req);
    const { studentId, severity, status, page = "1", limit = "20" } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);

    const where: any = { branchId };
    if (studentId) where.studentId = studentId;
    if (severity) where.severity = severity;
    if (status) where.status = status;

    const [incidents, total] = await Promise.all([
      prisma.disciplineIncident.findMany({
        where,
        orderBy: { incidentDate: "desc" },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        include: { student: { include: { user: { select: { name: true } } } } },
      }),
      prisma.disciplineIncident.count({ where }),
    ]);

    sendPaginated(res, incidents, total, pageNum, limitNum);
  } catch (error) {
    sendError(res, "Failed to fetch incidents", 500, (error as Error).message);
  }
};

/**
 * PATCH /academics/discipline/:id/action - Take action on an incident
 */
export const takeAction = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { actionTaken, resolution, parentNotified } = req.body;

    const incident = await prisma.disciplineIncident.update({
      where: { id },
      data: {
        actionTaken,
        actionDate: new Date(),
        actionBy: req.user!.userId,
        resolution,
        parentNotified: parentNotified || false,
        status: resolution ? "RESOLVED" : "IN_PROGRESS",
      },
    });

    sendSuccess(res, incident, "Action recorded");
  } catch (error) {
    sendError(res, "Failed to record action", 500, (error as Error).message);
  }
};

/**
 * GET /academics/discipline/student/:studentId - Get student's discipline history
 */
export const getStudentDisciplineHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { studentId } = req.params;

    const incidents = await prisma.disciplineIncident.findMany({
      where: { studentId },
      orderBy: { incidentDate: "desc" },
    });

    sendSuccess(res, incidents);
  } catch (error) {
    sendError(res, "Failed to fetch discipline history", 500, (error as Error).message);
  }
};
