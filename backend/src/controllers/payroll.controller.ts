import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { resolveBranchId, resolveEffectiveBranchId, canAccessBranch } from "../utils/branchScope";
import { canAccessStaffRecord } from "../utils/staffAccess";
import { startPdfResponse, sendPdfBuffer, drawHeader, drawFooter, drawKeyValueRow, drawQrCode, formatMoney } from "../services/pdf.service";
import { renderTemplateToPdf } from "../services/templateRenderer.service";
import { getActiveDocumentTemplate } from "../services/documentTemplateLookup.service";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

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
 *
 * SECURITY: previously had no access check at all beyond `authenticate`
 * - any logged-in user (e.g. a Teacher) could read ANY other staff
 * member's salary structure just by supplying their staffId, including
 * staff in a completely different branch. Salary is exactly the kind
 * of need-to-know data this must not leak (IDOR).
 */
export const getSalaryStructure = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { staffId } = req.params;
    if (!(await canAccessStaffRecord(req, staffId))) {
      sendError(res, "Staff not found", 404);
      return;
    }
    const structure = await prisma.salaryStructure.findUnique({ where: { staffId } });
    sendSuccess(res, structure, "Salary structure fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Run payroll for a month (generate payslips for all/selected staff)
 */
export const runPayroll = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { month, year } = req.body;

    // BUG FIX: the frontend used to hardcode `branchId: ""` on this
    // request (unlike every other "create" form, which simply omits
    // branchId and lets the server resolve it). Because this handler
    // read `branchId` straight off req.body and used it directly in a
    // `where: { branchId }` filter, an empty string matched ZERO staff
    // for every branch - the request still returned 200 "Payroll run:
    // 0 payslips generated", so it silently did nothing instead of
    // erroring, on every single run. Resolve it the same way every
    // other create/list endpoint does instead of trusting the body.
    const branchId = resolveEffectiveBranchId(req, req.body.branchId);
    if (!branchId) {
      sendError(res, "Branch ID could not be resolved - please select a branch", 400);
      return;
    }
    if (!canAccessBranch(req, branchId)) {
      sendError(res, "Access denied: branch mismatch", 403);
      return;
    }

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
    const branchId = resolveBranchId(req);

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
 *
 * SECURITY: previously had no access check at all beyond `authenticate`
 * - same IDOR class as getSalaryStructure above, but for the payslip
 * (gross earning, deductions, net pay) instead of the salary structure.
 */
export const getStaffPayslip = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { staffId, month, year } = req.params;
    if (!(await canAccessStaffRecord(req, staffId))) {
      sendError(res, "Payslip not found", 404);
      return;
    }
    const payslip = await prisma.payslip.findUnique({
      where: { staffId_month_year: { staffId, month: parseInt(month), year: parseInt(year) } },
      include: { staff: { include: { user: { select: { name: true, email: true } }, salaryStructure: true } } },
    });
    if (!payslip) { sendError(res, "Payslip not found", 404); return; }
    sendSuccess(res, payslip, "Payslip fetched");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * GET /api/hr/payroll/payslip/:staffId/:month/:year/pdf
 * Streams a printable payslip PDF for one staff member's payslip for a
 * given month/year. Tries the admin-uploaded PAYSLIP DocumentTemplate
 * first (see templateRenderer.service.ts); falls back to a plain
 * PDFKit layout below when no usable template is available.
 *
 * Access: branch admin staff, or the staff member downloading their
 * OWN payslip (same self-access convention already used by the ID card
 * endpoints in document.controller.ts) - a payslip contains the same
 * kind of sensitive financial data as a fee receipt, so it shouldn't be
 * open to every authenticated user the way getStaffPayslip (JSON) is
 * today.
 */
export const getPayslipPdf = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { staffId, month, year } = req.params;

    const payslip = await prisma.payslip.findUnique({
      where: { staffId_month_year: { staffId, month: parseInt(month), year: parseInt(year) } },
      include: {
        staff: {
          include: {
            user: { select: { id: true, name: true } },
            branch: { select: { name: true, address: true, city: true, state: true, pincode: true, phone: true } },
          },
        },
      },
    });
    if (!payslip) { sendError(res, "Payslip not found", 404); return; }

    const isSelf = req.user?.userId === payslip.staff.user.id;
    if (!canAccessBranch(req, payslip.staff.branchId) && !isSelf) {
      sendError(res, "Payslip not found", 404);
      return;
    }

    const monthLabel = MONTH_NAMES[payslip.month - 1] || String(payslip.month);
    const filename = `payslip-${payslip.staff.employeeId}-${monthLabel}-${payslip.year}.pdf`;

    const payslipTemplate = await getActiveDocumentTemplate("PAYSLIP");
    const fromTemplate = await renderTemplateToPdf(payslipTemplate?.templateUrl, {
      staffName: payslip.staff.user.name,
      employeeId: payslip.staff.employeeId,
      designation: payslip.staff.designation,
      department: payslip.staff.department,
      month: monthLabel,
      year: String(payslip.year),
      workingDays: String(payslip.workingDays),
      presentDays: String(payslip.presentDays),
      basic: "", // Basic/HRA/DA breakdown lives on SalaryStructure, not
      hra: "",   // Payslip itself (which only stores the computed
      da: "",    // totals) - left blank unless a future enhancement
                 // joins SalaryStructure in here too.
      grossEarning: formatMoney(payslip.grossEarning),
      pfAmount: formatMoney(payslip.pfAmount),
      esiAmount: formatMoney(payslip.esiAmount),
      tdsAmount: formatMoney(payslip.tdsAmount),
      totalDeduction: formatMoney(payslip.totalDeduction),
      netPay: formatMoney(payslip.netPay),
      branchName: payslip.staff.branch.name,
      branchAddress: [payslip.staff.branch.address, payslip.staff.branch.city, payslip.staff.branch.state, payslip.staff.branch.pincode].filter(Boolean).join(", "),
      branchPhone: payslip.staff.branch.phone || "",
    });
    if (fromTemplate) {
      sendPdfBuffer(res, filename, fromTemplate);
      return;
    }

    const doc = startPdfResponse(res, filename);
    drawHeader(doc, payslip.staff.branch.name, `Payslip - ${monthLabel} ${payslip.year}`);

    const leftX = doc.page.margins.left;
    let y = doc.y;
    drawKeyValueRow(doc, "Employee Name", payslip.staff.user.name, leftX, y); y += 18;
    drawKeyValueRow(doc, "Employee ID", payslip.staff.employeeId, leftX, y); y += 18;
    drawKeyValueRow(doc, "Designation", payslip.staff.designation, leftX, y); y += 18;
    drawKeyValueRow(doc, "Department", payslip.staff.department, leftX, y); y += 18;
    drawKeyValueRow(doc, "Working Days", String(payslip.workingDays), leftX, y); y += 18;
    drawKeyValueRow(doc, "Present Days", String(payslip.presentDays), leftX, y); y += 24;
    doc.y = y;

    doc.moveTo(leftX, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor("#cbd5e1").stroke();
    doc.moveDown(0.5);

    const amountRow = (label: string, value: string, color = "#0f172a") => {
      const rowY = doc.y;
      doc.fontSize(10).fillColor("#475569").text(label, leftX, rowY);
      doc.fontSize(10).fillColor(color).text(value, leftX, rowY, { align: "right", width: doc.page.width - doc.page.margins.left - doc.page.margins.right });
      doc.moveDown(0.6);
    };

    amountRow("Gross Earning", formatMoney(payslip.grossEarning));
    amountRow("PF Deduction", `- ${formatMoney(payslip.pfAmount)}`, "#b91c1c");
    amountRow("ESI Deduction", `- ${formatMoney(payslip.esiAmount)}`, "#b91c1c");
    amountRow("TDS Deduction", `- ${formatMoney(payslip.tdsAmount)}`, "#b91c1c");

    doc.moveTo(leftX, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor("#cbd5e1").stroke();
    doc.moveDown(0.5);

    const netY = doc.y;
    doc.fontSize(12).fillColor("#0f172a").text("Net Pay", leftX, netY);
    doc.fontSize(12).fillColor("#15803d").text(
      formatMoney(payslip.netPay),
      leftX,
      netY,
      { align: "right", width: doc.page.width - doc.page.margins.left - doc.page.margins.right }
    );

    doc.moveDown(2);
    doc.fontSize(9).fillColor("#94a3b8").text(
      `Payslip status: ${payslip.status}. This is a computer-generated payslip and does not require a signature.`
    );

    // QR code summarizing the payslip, fixed to the bottom-right of the
    // page (independent of the content flow above it).
    const qrSize = 60;
    await drawQrCode(
      doc,
      `Payslip: ${monthLabel} ${payslip.year}\n${payslip.staff.branch.name}\nEmployee: ${payslip.staff.user.name} (${payslip.staff.employeeId})\nNet Pay: ${formatMoney(payslip.netPay)}`,
      doc.page.width - doc.page.margins.right - qrSize,
      doc.page.height - doc.page.margins.bottom - qrSize - 26,
      qrSize,
      "Scan for payslip summary"
    );

    drawFooter(doc, `${payslip.staff.branch.name} - ${[payslip.staff.branch.address, payslip.staff.branch.city, payslip.staff.branch.state, payslip.staff.branch.pincode].filter(Boolean).join(", ")}`);

    doc.end();
  } catch (error) {
    sendError(res, "Failed to generate payslip PDF", 500, (error as Error).message);
  }
};
