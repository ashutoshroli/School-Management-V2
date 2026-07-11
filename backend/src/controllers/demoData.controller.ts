import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { resolveEffectiveBranchId, canAccessBranch } from "../utils/branchScope";
import { logAuditFromRequest } from "../services/auditLog.service";
import { generateDemoDataForBranch, DemoDataOptions } from "../services/demoData.service";

/**
 * POST /admin/demo-data/generate
 *
 * Admin-only utility (Settings page) that bulk-fills a branch with
 * realistic demo data - see demoData.service.ts's header comment for
 * exactly what it creates and what it deliberately leaves alone.
 *
 * Same branchId resolution as every other "create X" endpoint
 * (resolveEffectiveBranchId): a Branch Admin always targets their own
 * branch; a Super Admin targets whichever branch they're currently
 * switched to (or an explicit branchId in the body, if ever sent).
 *
 * Runs synchronously within the request - deliberately not queued as
 * a background job (no job queue exists in this codebase), so this can
 * take anywhere from several seconds to a couple of minutes depending
 * on the counts requested. The frontend disables/shows a spinner on
 * the trigger button for the duration rather than polling a job status.
 */
export const generateDemoData = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const branchId = resolveEffectiveBranchId(req, req.body.branchId);

    if (!branchId) {
      sendError(res, "Branch ID could not be resolved - please select a branch", 400);
      return;
    }
    if (!canAccessBranch(req, branchId)) {
      sendError(res, "Access denied: branch mismatch", 403);
      return;
    }

    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch) {
      sendError(res, "Branch not found", 404);
      return;
    }

    const options: DemoDataOptions = {
      studentsPerSection: req.body.studentsPerSection !== undefined ? Number(req.body.studentsPerSection) : undefined,
      staffCount: req.body.staffCount !== undefined ? Number(req.body.staffCount) : undefined,
      attendanceDays: req.body.attendanceDays !== undefined ? Number(req.body.attendanceDays) : undefined,
      includeFeesAndPayments: req.body.includeFeesAndPayments,
      includeExamsAndMarks: req.body.includeExamsAndMarks,
      includeAttendance: req.body.includeAttendance,
      includeHomeworkAndNotices: req.body.includeHomeworkAndNotices,
      includeTransportAndLibrary: req.body.includeTransportAndLibrary,
    };

    // Guard against NaN slipping through from a malformed/empty numeric
    // field (matches createClass's numericOrder guard elsewhere) -
    // without this, Number("") -> NaN would propagate into the
    // service's Math.min/Math.max clamps and produce a NaN count.
    if (options.studentsPerSection !== undefined && !Number.isFinite(options.studentsPerSection)) options.studentsPerSection = undefined;
    if (options.staffCount !== undefined && !Number.isFinite(options.staffCount)) options.staffCount = undefined;
    if (options.attendanceDays !== undefined && !Number.isFinite(options.attendanceDays)) options.attendanceDays = undefined;

    const result = await generateDemoDataForBranch(branchId, req.user!.userId, options);

    logAuditFromRequest(req, "CREATE", "demo_data", branchId, { newData: result });

    sendSuccess(res, result, `Demo data generated for ${branch.name}`, 201);
  } catch (error) {
    sendError(res, "Failed to generate demo data", 500, (error as Error).message);
  }
};
