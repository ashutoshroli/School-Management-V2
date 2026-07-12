import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";

/**
 * GET /students/:studentId/health - Get student health record
 */
export const getStudentHealth = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { studentId } = req.params;

    const health = await prisma.studentHealth.findUnique({
      where: { studentId },
      include: {
        immunizations: { orderBy: { dateGiven: "desc" } },
        healthVisits: { orderBy: { visitDate: "desc" }, take: 20 },
      },
    });

    if (!health) {
      sendSuccess(res, null, "No health record found");
      return;
    }

    sendSuccess(res, health);
  } catch (error) {
    sendError(res, "Failed to fetch health record", 500, (error as Error).message);
  }
};

/**
 * POST /students/:studentId/health - Create or update health record
 */
export const upsertStudentHealth = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { studentId } = req.params;
    const { height, weight, allergies, chronicConditions, medications, emergencyContact, emergencyPhone, doctorName, doctorPhone, insuranceId, lastCheckupDate, notes } = req.body;

    const health = await prisma.studentHealth.upsert({
      where: { studentId },
      update: {
        height, weight, allergies, chronicConditions, medications,
        emergencyContact, emergencyPhone, doctorName, doctorPhone,
        insuranceId, lastCheckupDate: lastCheckupDate ? new Date(lastCheckupDate) : undefined, notes,
      },
      create: {
        studentId, height, weight, allergies, chronicConditions, medications,
        emergencyContact, emergencyPhone, doctorName, doctorPhone,
        insuranceId, lastCheckupDate: lastCheckupDate ? new Date(lastCheckupDate) : null, notes,
      },
    });

    sendSuccess(res, health, "Health record saved");
  } catch (error) {
    sendError(res, "Failed to save health record", 500, (error as Error).message);
  }
};

/**
 * POST /students/:studentId/health/immunizations - Add immunization
 */
export const addImmunization = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { studentId } = req.params;
    const { vaccineName, doseNumber, dateGiven, nextDueDate, administeredBy, notes } = req.body;

    // Ensure health record exists
    let health = await prisma.studentHealth.findUnique({ where: { studentId } });
    if (!health) {
      health = await prisma.studentHealth.create({ data: { studentId } });
    }

    const immunization = await prisma.immunization.create({
      data: {
        studentHealthId: health.id,
        vaccineName,
        doseNumber: doseNumber || 1,
        dateGiven: new Date(dateGiven),
        nextDueDate: nextDueDate ? new Date(nextDueDate) : null,
        administeredBy,
        notes,
      },
    });

    sendSuccess(res, immunization, "Immunization added", 201);
  } catch (error) {
    sendError(res, "Failed to add immunization", 500, (error as Error).message);
  }
};

/**
 * POST /students/:studentId/health/visits - Add health visit
 */
export const addHealthVisit = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { studentId } = req.params;
    const { visitDate, reason, diagnosis, treatment, attendedBy, followUpDate, notes } = req.body;

    let health = await prisma.studentHealth.findUnique({ where: { studentId } });
    if (!health) {
      health = await prisma.studentHealth.create({ data: { studentId } });
    }

    const visit = await prisma.healthVisit.create({
      data: {
        studentHealthId: health.id,
        visitDate: new Date(visitDate),
        reason,
        diagnosis,
        treatment,
        attendedBy,
        followUpDate: followUpDate ? new Date(followUpDate) : null,
        notes,
      },
    });

    sendSuccess(res, visit, "Health visit recorded", 201);
  } catch (error) {
    sendError(res, "Failed to add health visit", 500, (error as Error).message);
  }
};
