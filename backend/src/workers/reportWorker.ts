import { Job } from "bull";
import { getQueue, QUEUE_NAMES } from "../queues";
import { DefaultersCsvJobData } from "../queues/report.queue";
import { fetchDefaulters, DEFAULTER_CSV_COLUMNS } from "../controllers/feeReports.controller";
import { buildCsv } from "../services/csvExport.service";
import { storage } from "../services/storage.service";
import { logger } from "../config/logger";

/**
 * Registers the processor for the "reports" queue on THIS process.
 * Must be called from a separate worker process (see workers/index.ts),
 * never from the API server's own process/app.ts - see
 * queues/index.ts's header comment for why.
 */
export const startReportWorker = (): void => {
  const queue = getQueue(QUEUE_NAMES.REPORTS);
  if (!queue) {
    logger.warn('Report worker not started: Redis is not configured (REDIS_URL unset)');
    return;
  }

  queue.process("defaulters-csv", async (job: Job<DefaultersCsvJobData>) => {
    logger.info("Processing defaulters-csv job", { jobId: job.id, branchId: job.data.branchId });

    const rows = await fetchDefaulters(job.data.branchId, job.data.classId);
    const csv = buildCsv(rows, DEFAULTER_CSV_COLUMNS);
    // Stored under uploads/reports/ so it's servable via the existing
    // `/uploads` static mount (see app.ts) once the job completes -
    // the requester polls GET /api/reports/jobs/:jobId (or similar) to
    // get this url once status is "completed".
    const { url } = await storage.save(Buffer.from(`\uFEFF${csv}`, "utf-8"), "defaulters.csv", "reports");

    logger.info("Defaulters-csv job complete", { jobId: job.id, url, rowCount: rows.length });
    return { url, rowCount: rows.length };
  });

  logger.info('Report worker started (queue: "reports")');
};
