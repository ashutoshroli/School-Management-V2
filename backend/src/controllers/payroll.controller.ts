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
 * Fallback non-break periods-per-day when a branch hasn't configured
 * its own PeriodConfig list yet - matches the frontend's own
 * getDefaultPeriods() default schedule (8 rows, 2 of them breaks ->
 * 6 non-break periods), so a freshly-onboarded branch's payroll ratio
 * lines up with what its attendance-marking UI would show by default.
 */
const DEFAULT_PERIODS_PER_DAY = 6;

interface SalaryTemplateInput {
  basic: number | string;
  da?: number | string;
  hra?: number | string;
  ta?: number | string;
  specialAllow?: number | string;
  medicalAllow?: number | string;
  otherAllow?: number | string;
  professionalTax?: number | string;
  otherDeduction?: number | string;
  taxRegime?: "OLD" | "NEW";
}

/**
 * PF/ESI/TDS/gross/net calculation, shared by upsertSalaryStructure
 * (single staff) and the bulk assignment endpoints below - extracted
 * so a "salary template" (basic + allowances + regime) always produces
 * identical computed figures regardless of whether it's applied to
 * one staff member or a hundred at once. ESI eligibility (gross <=
 * 21000) and the TDS slabs both only ever depend on the template's own
 * numbers, never on anything staff-specific, so recomputing this once
 * per staff member in bulk still yields exactly the same result as
 * calling this once per staff member individually - just without an
 * N+1 round trip to get there.
 */
const calculateSalaryStructure = (input: SalaryTemplateInput) => {
  const basic = Number(input.basic);
  const da = Number(input.da || 0);
  const hra = Number(input.hra || 0);
  const ta = Number(input.ta || 0);
  const specialAllow = Number(input.specialAllow || 0);
  const medicalAllow = Number(input.medicalAllow || 0);
  const otherAllow = Number(input.otherAllow || 0);
  const professionalTax = Number(input.professionalTax || 0);
  const otherDeduction = Number(input.otherDeduction || 0);
  const taxRegime = input.taxRegime || "NEW";

  // Auto-calculate PF & ESI
  const basicDa = basic + da;
  const pfEmployee = Math.round(basicDa * 0.12); // 12% of basic+DA
  const pfEmployer = Math.round(basicDa * 0.12);
  const gross = basic + da + hra + ta + specialAllow + medicalAllow + otherAllow;

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

  const totalDeductions = pfEmployee + esiEmployee + monthlyTds + professionalTax + otherDeduction;
  const netSalary = gross - totalDeductions;

  return {
    basic, da, hra, ta, specialAllow, medicalAllow, otherAllow,
    pfEmployee, pfEmployer, esiEmployee, esiEmployer,
    professionalTax, tds: monthlyTds, otherDeduction,
    grossSalary: gross, netSalary, taxRegime,
  };
};

/**
 * Create/Update salary structure for staff
 */
export const upsertSalaryStructure = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { staffId } = req.body;
    const calculated = calculateSalaryStructure(req.body);

    const structure = await prisma.salaryStructure.upsert({
      where: { staffId },
      update: calculated,
      create: { staffId, ...calculated },
    });

    sendSuccess(res, structure, "Salary structure saved");
  } catch (error) { sendError(res, "Failed", 500, (error as Error).message); }
};

/**
 * Bulk-assign a salary structure "template" (basic + allowances +
 * deductions + tax regime) to every ACTIVE staff member in the branch
 * matching the given filters (type/department/designation) - the
 * payroll counterpart to bulkAssignFees for students. Every matched
 * staff member receives the exact same template; PF/ESI/TDS/gross/net
 * are computed per staff member via calculateSalaryStructure (see its
 * doc comment for why this is safe to do in bulk).
 *
 * Staff who already have a salary structure are SKIPPED by default -
 * pass `overwriteExisting: true` to instead update theirs to the new
 * template too, mirroring the skip-vs-explicit-overwrite convention
 * used across this codebase's other bulk-assignment endpoints.
 *
 * Uses one bulk updateMany (for staff being overwritten) + one bulk
 * createMany (for staff getting a structure for the first time)
 * rather than a per-staff upsert loop - safe here specifically because
 * every matched staff member is getting IDENTICAL data, so there's
 * nothing that varies row-to-row for updateMany to lose.
 */
export const bulkAssignSalaryStructure = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { department, designation, type, overwriteExisting, ...template } = req.body;

    const branchId = resolveEffectiveBranchId(req, req.body.branchId);
    if (!branchId) {
      sendError(res, "Branch ID could not be resolved - please select a branch", 400);
      return;
    }
    if (!canAccessBranch(req, branchId)) {
      sendError(res, "Access denied: branch mismatch", 403);
      return;
    }

    const where: any = { branchId, isActive: true };
    if (type) where.type = type;
    if (department) where.department = department;
    if (designation) where.designation = designation;

    const staffList = await prisma.staff.findMany({ where, select: { id: true } });
    if (staffList.length === 0) {
      sendSuccess(res, { created: 0, updated: 0, skipped: 0, total: 0 }, "No staff matched the given filters");
      return;
    }

    const staffIds = staffList.map((s) => s.id);
    const existing = await prisma.salaryStructure.findMany({
      where: { staffId: { in: staffIds } },
      select: { staffId: true },
    });
    const existingIds = existing.map((e) => e.staffId);
    const existingSet = new Set(existingIds);
    const newIds = staffIds.filter((id) => !existingSet.has(id));

    const calculated = calculateSalaryStructure(template);

    let updated = 0;
    if (overwriteExisting && existingIds.length > 0) {
      const result = await prisma.salaryStructure.updateMany({
        where: { staffId: { in: existingIds } },
        data: calculated,
      });
      updated = result.count;
    }

    let created = 0;
    if (newIds.length > 0) {
      const result = await prisma.salaryStructure.createMany({
        data: newIds.map((staffId) => ({ staffId, ...calculated })),
      });
      created = result.count;
    }

    const skipped = overwriteExisting ? 0 : existingIds.length;

    sendSuccess(
      res,
      { created, updated, skipped, total: staffIds.length },
      `Salary structure assigned to ${created + updated} staff member(s)` +
        (skipped > 0 ? ` (${skipped} skipped - already have a salary structure)` : "")
    );
  } catch (error) {
    sendError(res, "Failed to bulk-assign salary structure", 500, (error as Error).message);
  }
};

/**
 * Assign a salary structure template to a specific, hand-picked list
 * of staffIds - the counterpart to bulkAssignSalaryStructure above
 * (which targets an entire department/designation/type). Used when
 * only some staff should get this template - e.g. a raise for a named
 * subset, or onboarding a new batch of hires who share a starting salary.
 */
export const assignSalaryStructureToStaff = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { staffIds, overwriteExisting, ...template } = req.body;

    if (!Array.isArray(staffIds) || staffIds.length === 0) {
      sendError(res, "staffIds must be a non-empty array", 400);
      return;
    }

    // Look up every requested staff member in one query - both to
    // validate they exist and to enforce branch access below (a
    // Branch Admin could otherwise smuggle in a staffId belonging to
    // a different branch - IDOR).
    const staffList = await prisma.staff.findMany({
      where: { id: { in: staffIds } },
      select: { id: true, branchId: true },
    });

    const foundIds = new Set(staffList.map((s) => s.id));
    const notFound = staffIds.filter((id: string) => !foundIds.has(id));
    if (notFound.length > 0) {
      sendError(res, `${notFound.length} staff member(s) in this list were not found`, 404);
      return;
    }
    const inaccessible = staffList.some((s) => !canAccessBranch(req, s.branchId));
    if (inaccessible) {
      sendError(res, "One or more staff members are not in a branch you can access", 403);
      return;
    }

    const existing = await prisma.salaryStructure.findMany({
      where: { staffId: { in: staffIds } },
      select: { staffId: true },
    });
    const existingIds = existing.map((e) => e.staffId);
    const existingSet = new Set(existingIds);
    const newIds = staffIds.filter((id: string) => !existingSet.has(id));

    const calculated = calculateSalaryStructure(template);

    let updated = 0;
    if (overwriteExisting && existingIds.length > 0) {
      const result = await prisma.salaryStructure.updateMany({
        where: { staffId: { in: existingIds } },
        data: calculated,
      });
      updated = result.count;
    }

    let created = 0;
    if (newIds.length > 0) {
      const result = await prisma.salaryStructure.createMany({
        data: newIds.map((staffId: string) => ({ staffId, ...calculated })),
      });
      created = result.count;
    }

    const skipped = overwriteExisting ? 0 : existingIds.length;

    sendSuccess(
      res,
      { created, updated, skipped, total: staffIds.length },
      `Salary structure assigned to ${created + updated} staff member(s)` +
        (skipped > 0 ? ` (${skipped} skipped - already have a salary structure)` : "")
    );
  } catch (error) {
    sendError(res, "Failed to assign salary structure", 500, (error as Error).message);
  }
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

    // Per-period-completion % (spec Section 6) - replaces the old
    // whole-day-count ratio. Salary is pro-rated against the actual
    // number of non-break periods completed in the month rather than
    // whole days, so the late-entry/early-exit penalty rule (Phase 5's
    // StaffAttendance.periodsDeducted) has something to actually
    // subtract from - a whole-day ratio has no unit smaller than a day
    // to deduct a "period" from. Falls back to
    // DEFAULT_PERIODS_PER_DAY when the branch hasn't configured its
    // own PeriodConfig list yet (see that constant's doc comment).
    const nonBreakPeriodCount = await prisma.periodConfig.count({ where: { branchId, isBreak: false } });
    const periodsPerDay = nonBreakPeriodCount > 0 ? nonBreakPeriodCount : DEFAULT_PERIODS_PER_DAY;
    const totalExpectedPeriods = workingDays * periodsPerDay;

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

      // Every marked day contributes its own full/half/leave-as-full
      // period credit for that day (same PRESENT/LATE/HALF_DAY/
      // ON_LEAVE-counts-as-present rules as before, just expressed in
      // periods instead of whole days), then has THAT day's own
      // periodsDeducted (Phase 5's late-entry/early-exit penalty)
      // subtracted, clamped so a single day can never go negative. An
      // unmarked day (implicitly ABSENT, no StaffAttendance row at
      // all) contributes zero periods, same as before.
      let totalPeriodsEarned = 0;
      let totalPeriodsDeducted = 0;
      for (const a of attendances) {
        let dayPeriods = 0;
        if (a.status === "PRESENT" || a.status === "LATE" || a.status === "ON_LEAVE") dayPeriods = periodsPerDay;
        else if (a.status === "HALF_DAY") dayPeriods = periodsPerDay * 0.5;
        totalPeriodsEarned += Math.max(dayPeriods - a.periodsDeducted, 0);
        totalPeriodsDeducted += a.periodsDeducted;
      }

      // Pro-rata salary against periods completed, not whole days.
      const ratio = totalExpectedPeriods > 0 ? totalPeriodsEarned / totalExpectedPeriods : 0;
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
          periodsDeducted: totalPeriodsDeducted,
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
    const department = req.query.department as string | undefined;
    const designation = req.query.designation as string | undefined;
    const search = req.query.search as string | undefined;

    const staffWhere: any = { branchId };
    if (department) staffWhere.department = department;
    if (designation) staffWhere.designation = designation;
    if (search) staffWhere.user = { name: { contains: search, mode: "insensitive" } };

    const payslips = await prisma.payslip.findMany({
      where: { month, year, staff: staffWhere },
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
      periodsDeducted: String(payslip.periodsDeducted),
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
    drawKeyValueRow(doc, "Present Days", String(payslip.presentDays), leftX, y); y += 18;
    if (payslip.periodsDeducted > 0) {
      drawKeyValueRow(doc, "Periods Deducted (late/early penalty)", String(payslip.periodsDeducted), leftX, y); y += 18;
    }
    y += 6;
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
