import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";

/**
 * Create/Update salary structure for staff
 */
export const upsertSalaryStructure = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { staffId, basic, da, hra, ta, specialAllow, medicalAllow, otherAllow, professionalTax, otherDeduction, taxRegime } = req.body;

    // Auto-calculate PF & ESI
    const basicDa = Number(basic) + Number(da || 0);
    const pfEmployee = Math.round(basicDa * 0.12); // 12% of basic+DA
    const pfEmployer = Math.round(basicDa * 0.12);
    const gross = Number(basic) + Number(da || 0) + Number(hra || 0) + Number(ta || 0) + Number(specialAllow || 0) + Number(medicalAllow || 0) + Number(otherAllow || 0);

    // ESI: applicable if gross <= 21000
    let esiEmployee = 0, esiEmployer = 0;
    if (gross <= 21000) {
      esiEmployee = Math.round(gross * 0.0075); // 0.75%
      esiEmployer = Math.round(gross * 0.0325); // 3.25%
    }

    // TDS: simplified monthly calculation (annual projected / 12)
    const annualGross = gross * 12;
    const standardDeduction = 50000;
    const taxableIncome = annualGross - standardDeduction - (pfEmployee * 12);
    let annualTds = 0;

    if (taxRegime === "NEW") {
      // New regime FY 2025-26 slabs
      if (taxableIncome > 1500000) annualTds = (taxableIncome - 1500000) * 0.30 + 150000;
      else if (taxableIncome > 1200000) annualTds = (taxableIncome - 1200000) * 0.20 + 90000;
      else if (taxableIncome > 900000) annualTds = (taxableIncome - 900000) * 0.15 + 45000;
      else if (taxableIncome > 600000) annualTds = (taxableIncome - 600000) * 0.10 + 15000;
      else if (taxableIncome > 300000) annualTds = (taxableIncome - 300000) * 0.05;
    } else {
      // Old regime
      if (taxableIncome > 1000000) annualTds = (taxableIncome - 1000000) * 0.30 + 112500;
      else if (taxableIncome > 500000) annualTds = (taxableIncome - 500000) * 0.20 + 12500;
      else if (taxableIncome > 250000) annualTds = (taxableIncome - 250000) * 0.05;
    }
    const monthlyTds = Math.round(annualTds / 12);

    const totalDeductions = pfEmployee + esiEmployee + monthlyTds + Number(professionalTax || 0) + Number(otherDeduction || 0);
    const netSalary = gross - totalDeductions;

    const structure = await prisma.salaryStructure.upsert({
      where: { staffId },
      update: { basic, da: da || 0, hra: hra || 0, ta: ta || 0, specialAllow: specialAllow || 0, medicalAllow: medicalAllow || 0, otherAllow: otherAllow || 0, pfEmployee, pfEmployer, esiEmployee, esiEmployer, professionalTax: professionalTax || 0, tds: monthlyTds, otherDeduction: otherDeduction || 0, grossSalary: gross, netSalary, taxRegime: taxRegime || "NEW" },
      create: { staffId, basic, da: da || 0, hra: hra || 0, ta: ta || 0, specialAllow: specialAllow || 0, medicalAllow: medicalAllow || 0, otherAllow: otherAllow || 0, pfEmployee, pfEmployer, esiEmployee, esiEmployer, professionalTax: professionalTax || 0, tds: monthlyTds, otherDeduction: otherDeduction || 0, grossSalary: gross, netSalary, taxRegime: taxRegime || "NEW" },
    });

    sendSuccess(res, structure, "Salary structure saved");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Get salary structure
 */
export const getSalaryStructure = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { staffId } = req.params;
    const structure = await prisma.salaryStructure.findUnique({ where: { staffId } });
    sendSuccess(res, structure, "Salary structure fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Run payroll for a month (generate payslips for all/selected staff)
 */
export const runPayroll = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { month, year, branchId } = req.body;

    const staffList = await prisma.staff.findMany({
      where: { branchId, isActive: true, salaryStructure: { isNot: null } },
      include: { salaryStructure: true, user: { select: { name: true } } },
    });

    // Get working days in month (assume 26)
    const workingDays = 26;
    let generated = 0, skipped = 0;

    for (const staff of staffList) {
      // Check if already generated
      const existing = await prisma.payslip.findUnique({
        where: { staffId_month_year: { staffId: staff.id, month, year } },
      });
      if (existing) { skipped++; continue; }

      const sal = staff.salaryStructure!;

      // Calculate attendance
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0);
      const attendances = await prisma.staffAttendance.findMany({
        where: { staffId: staff.id, date: { gte: startDate, lte: endDate } },
      });

      const presentDays = attendances.filter(a => a.status === "PRESENT" || a.status === "LATE").length;
      const halfDays = attendances.filter(a => a.status === "HALF_DAY").length;
      const leaveDays = attendances.filter(a => a.status === "ON_LEAVE").length;
      const absentDays = workingDays - presentDays - halfDays - leaveDays;
      const effectiveDays = presentDays + (halfDays * 0.5) + leaveDays; // leave counted as present

      // Pro-rata salary
      const ratio = effectiveDays / workingDays;
      const grossEarning = Math.round(Number(sal.grossSalary) * ratio);
      const pfAmount = Math.round(Number(sal.pfEmployee) * ratio);
      const esiAmount = Math.round(Number(sal.esiEmployee) * ratio);
      const tdsAmount = Math.round(Number(sal.tds) * ratio);
      const totalDeduction = pfAmount + esiAmount + tdsAmount + Number(sal.professionalTax) + Number(sal.otherDeduction);
      const netPay = grossEarning - totalDeduction;

      await prisma.payslip.create({
        data: {
          staffId: staff.id, month, year,
          workingDays, presentDays: presentDays + halfDays, leaveDays, absentDays,
          grossEarning, totalDeduction, netPay,
          pfAmount, esiAmount, tdsAmount,
          status: "DRAFT",
        },
      });
      generated++;
    }

    sendSuccess(res, { generated, skipped, total: staffList.length }, `Payroll run: ${generated} payslips generated, ${skipped} skipped (already exist)`);
  } catch (error) { sendError(res, "Failed to run payroll", 500, (error as Error).message); }
};

/**
 * Get payslips for a month
 */
export const getPayslips = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const month = parseInt(req.query.month as string);
    const year = parseInt(req.query.year as string);
    const branchId = req.query.branchId as string || req.user!.branchId;

    const payslips = await prisma.payslip.findMany({
      where: { month, year, staff: { branchId } },
      include: { staff: { include: { user: { select: { name: true } } } } },
      orderBy: { staff: { user: { name: "asc" } } },
    });

    const totalNetPay = payslips.reduce((s, p) => s + Number(p.netPay), 0);
    const totalPf = payslips.reduce((s, p) => s + Number(p.pfAmount), 0);
    const totalEsi = payslips.reduce((s, p) => s + Number(p.esiAmount), 0);
    const totalTds = payslips.reduce((s, p) => s + Number(p.tdsAmount), 0);

    sendSuccess(res, { payslips, summary: { totalNetPay, totalPf, totalEsi, totalTds, count: payslips.length } }, "Payslips fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Approve payslip (mark as APPROVED -> ready for payment)
 */
export const approvePayslip = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const updated = await prisma.payslip.update({ where: { id }, data: { status: "APPROVED" } });
    sendSuccess(res, updated, "Payslip approved");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Mark payslip as PAID
 */
export const markPaid = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const updated = await prisma.payslip.update({ where: { id }, data: { status: "PAID", paidAt: new Date() } });
    sendSuccess(res, updated, "Payslip marked as paid");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Get single staff's payslip
 */
export const getStaffPayslip = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { staffId, month, year } = req.params;
    const payslip = await prisma.payslip.findUnique({
      where: { staffId_month_year: { staffId, month: parseInt(month), year: parseInt(year) } },
      include: { staff: { include: { user: { select: { name: true, email: true } }, salaryStructure: true } } },
    });
    if (!payslip) { sendError(res, "Payslip not found", 404); return; }
    sendSuccess(res, payslip, "Payslip fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};
