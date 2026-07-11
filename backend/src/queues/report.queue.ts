import { getQueue, QUEUE_NAMES } from "./index";

/**
 * Job payload for the "defaulters-csv" job type on the reports queue.
 * The worker regenerates the same CSV `feeReports.controller.ts`'s
 * `exportDefaultersCsv` builds synchronously today, but writes it to
 * disk (uploads dir) instead of streaming it directly in an HTTP
 * response, since a queued job has no live response to write to.
 */
export interface DefaultersCsvJobData {
  branchId: string;
  classId?: string;
  /** Used to name the output file so the requester can find it later (e.g. GET /uploads/reports/<requestedBy>-<jobId>.csv). */
  requestedBy: string;
}

/**
 * Enqueues (or, if Redis isn't configured, returns queued:false so the
 * caller keeps its existing synchronous behavior) a defaulters CSV
 * export job. Large branches (thousands of students) can make this
 * report slow enough to risk a request timeout - queuing it lets the
 * request return immediately with a jobId instead.
 */
export const enqueueDefaultersCsvExport = (data: DefaultersCsvJobData): { queued: true; jobId: string } | { queued: false } => {
  const queue = getQueue(QUEUE_NAMES.REPORTS);
  if (!queue) return { queued: false };

  // Fire-and-forget from the caller's perspective - the job is added
  // synchronously (this is just a Redis write, not the report work
  // itself), but we don't await job completion here.
  let jobId = "";
  queue
    .add("defaulters-csv", data)
    .then((job) => {
      jobId = String(job.id);
    })
    .catch(() => {
      /* logged by the queue's own "error" handler in queues/index.ts */
    });

  return { queued: true, jobId };
};
