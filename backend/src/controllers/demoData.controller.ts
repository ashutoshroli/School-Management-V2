import { Response } from "express";
import prisma from "../config/database";
import { AuthRequest } from "../types";
import { sendSuccess, sendError } from "../utils/response";
import { resolveEffectiveBranchId, canAccessBranch } from "../utils/branchScope";
import { logAuditFromRequest } from "../services/auditLog.service";
import { invalidateClassesCache } from "../services/cache.service";
import {
  generateDemoDataForBranch, DemoDataOptions,
  seedDemoData, removeDemoData, getDemoDataStatus, DEMO_BRANCH_ID,
} from "../services/demoData.service";

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

    // Demo data creates students in sections - invalidate the cached
    // class list so section occupancy counts update immediately.
    await invalidateClassesCache(branchId);

    logAuditFromRequest(req, "CREATE", "demo_data", branchId, { newData: result });

    sendSuccess(res, result, `Demo data generated for ${branch.name}`, 201);
  } catch (error) {
    sendError(res, "Failed to generate demo data", 500, (error as Error).message);
  }
};

/**
 * GET /api/demo-data/status
 * SUPER_ADMIN only. Powers the "Demo Data" card on the Admin Portal's
 * Settings page - tells the frontend whether the STRUCTURAL demo data
 * (org/branch/classes/subjects/etc, from seedDemoData below) currently
 * exists, some headline counts, and whether "Remove Demo Data" is
 * currently safe to offer (and why not, if it isn't).
 */
export const getStatus = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const status = await getDemoDataStatus();
    sendSuccess(res, status, "Demo data status fetched");
  } catch (error) {
    sendError(res, "Failed to fetch demo data status", 500, (error as Error).message);
  }
};

/**
 * POST /api/demo-data/seed
 * SUPER_ADMIN only. Server-side equivalent of running
 * `db/prisma/seed.ts` from a developer's own machine (see DEPLOY.md's
 * Step 4) - lets a Super Admin populate a trial deployment with the
 * demo organization/branch/classes/subjects/fee categories/chart of
 * accounts/leave types/permissions entirely from the Admin Portal, no
 * Shell/SSH access required (Render's free tier does not provide any).
 * Idempotent - safe to click more than once. Once this exists, use
 * "Generate Demo Data" (generateDemoData above) to fill the branch with
 * realistic students/staff/fees/attendance/etc.
 */
export const seed = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const summary = await seedDemoData();

    logAuditFromRequest(req, "CREATE", "demoData", DEMO_BRANCH_ID, { newData: summary });

    sendSuccess(res, summary, "Demo data added successfully", 201);
  } catch (error) {
    sendError(res, "Failed to add demo data", 500, (error as Error).message);
  }
};

/**
 * POST /api/demo-data/remove
 * SUPER_ADMIN only. Tears down everything seedDemoData creates -
 * refuses to run if any real records (students, payments, staff
 * beyond the demo Branch Admin, etc - including anything created via
 * "Generate Demo Data" above) have been layered on top of the demo
 * branch, returning exactly what's blocking it so the admin knows what
 * to check.
 */
export const remove = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await removeDemoData(req.user!.userId);

    if (!result.removed) {
      sendError(res, result.message, 400, result.blockedReasons ? JSON.stringify(result.blockedReasons) : undefined);
      return;
    }

    logAuditFromRequest(req, "DELETE", "demoData", DEMO_BRANCH_ID, { oldData: result });

    sendSuccess(res, null, result.message);
  } catch (error) {
    sendError(res, "Failed to remove demo data", 500, (error as Error).message);
  }
};
