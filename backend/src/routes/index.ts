import { Router } from "express";
import prisma from "../config/database";
import { getRedisClient, isRedisConfigured } from "../config/redis";
import { logger } from "../config/logger";
import authRoutes from "./auth.routes";
import branchRoutes from "./branch.routes";
import academicYearRoutes from "./academicYear.routes";
import classRoutes from "./class.routes";
import studentRoutes from "./student.routes";
import staffRoutes from "./staff.routes";
import feeRoutes from "./fee.routes";
import accountingRoutes from "./accounting.routes";
import hrRoutes from "./hr.routes";
import academicsRoutes from "./academics.routes";
import facilitiesRoutes from "./facilities.routes";
import communicationRoutes from "./communication.routes";
import reportsRoutes from "./reports.routes";
import parentRoutes from "./parent.routes";
import admissionRoutes from "./admission.routes";
import templateRoutes from "./template.routes";
import demoDataRoutes from "./demoData.routes";
import publicRoutes from "./public.routes";
// TEMPORARY - see debug.routes.ts's own header comment. Delete this
// import + the router.use("/debug", ...) line below, and the whole
// debug.routes.ts file, once you've finished verifying this deploy.
import debugRoutes from "./debug.routes";

const router = Router();

// Health check
//
// IMPORTANT: this route's own HTTP status is ALWAYS 200 (as long as
// the process itself is alive), regardless of database/redis status -
// render.yaml's `healthCheckPath: /api/health` points Render's own
// health monitor at this exact route, and Render restarts/recycles a
// service whose health check returns a non-2xx status. Returning 503
// here whenever the database happened to be briefly unreachable (a
// transient network blip, a Neon cold-start, etc) would make Render
// treat a temporary hiccup as "the whole service is down" and
// potentially restart-loop it - the database/redis dependency
// statuses are reported IN THE BODY instead, precisely so you (or any
// monitoring you point at this route) can distinguish "process is up
// but a dependency is degraded" from "process is actually down"
// without that distinction ever affecting Render's own restart
// decision.
router.get("/health", async (_req, res) => {
  const [database, redis] = await Promise.all([
    // `SELECT 1` is the standard "is this connection actually alive"
    // probe - cheap, no table dependency, works identically on every
    // Postgres-compatible provider (Neon, Supabase, RDS, ...).
    prisma
      .$queryRaw`SELECT 1`
      .then(() => "ok" as const)
      .catch((error) => {
        logger.warn("Health check: database query failed", { errorMessage: (error as Error).message });
        return "fail" as const;
      }),
    (async () => {
      if (!isRedisConfigured()) return "not_configured" as const;
      try {
        const client = getRedisClient();
        if (!client) return "fail" as const;
        const pong = await client.ping();
        return pong === "PONG" ? ("ok" as const) : ("fail" as const);
      } catch (error) {
        logger.warn("Health check: redis ping failed", { errorMessage: (error as Error).message });
        return "fail" as const;
      }
    })(),
  ]);

  res.json({
    success: true,
    message: "School ERP API is running",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    database,
    redis,
  });
});

// TEMPORARY Sentry verification route - intentionally throws so you can
// confirm SENTRY_DSN is wired up correctly end-to-end (hit
// GET /api/debug-sentry, then check the Sentry dashboard for a new
// event). This is deliberately unauthenticated/unguarded so it's easy
// to test right after deploying, matching Sentry's own official Express
// tutorial (https://docs.sentry.io/platforms/javascript/guides/express/)
// - but it should be REMOVED once you've confirmed events are showing
// up in Sentry, since a route that always throws is otherwise dead
// weight (and needless noise/quota usage if anyone else finds it).
router.get("/debug-sentry", () => {
  throw new Error("Sentry test error - if you can see this in your Sentry dashboard, the setup works!");
});

// TEMPORARY - DELETE AFTER VERIFICATION. See debug.routes.ts's header
// comment for what each route under here does and why they're
// SUPER_ADMIN-gated (unlike /debug-sentry above, these place a real
// Razorpay order / send a real email / send a real push / touch your
// real R2 bucket).
router.use("/debug", debugRoutes);

// Mount routes
router.use("/auth", authRoutes);
router.use("/branches", branchRoutes);
router.use("/academic-years", academicYearRoutes);
router.use("/classes", classRoutes);
router.use("/students", studentRoutes);
router.use("/staff", staffRoutes);
router.use("/fees", feeRoutes);
router.use("/accounting", accountingRoutes);
router.use("/hr", hrRoutes);
router.use("/academics", academicsRoutes);
router.use("/facilities", facilitiesRoutes);
router.use("/communication", communicationRoutes);
router.use("/reports", reportsRoutes);
router.use("/parent", parentRoutes);
router.use("/admission", admissionRoutes);
router.use("/templates", templateRoutes);
router.use("/demo-data", demoDataRoutes);
router.use("/public", publicRoutes);

// router.use("/attendance", attendanceRoutes); // Phase 4
// router.use("/exams", examRoutes);            // Phase 4
// router.use("/library", libraryRoutes);       // Phase 5
// router.use("/transport", transportRoutes);   // Phase 5
// router.use("/hostel", hostelRoutes);         // Phase 5
// router.use("/inventory", inventoryRoutes);   // Phase 5
// router.use("/notices", noticeRoutes);        // Phase 6
// router.use("/messages", messageRoutes);      // Phase 6
// router.use("/certificates", certRoutes);     // Phase 6
// router.use("/reports", reportRoutes);        // Phase 7

export default router;
