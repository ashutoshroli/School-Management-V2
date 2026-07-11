import { getQueue, QUEUE_NAMES } from "./index";
import { sendFeeReminders, FeeReminderResult } from "../services/feeReminder.service";

/** Job payload for the "fee-reminders" job type on the notifications queue. */
export interface FeeReminderJobData {
  branchId: string;
}

/**
 * Enqueues (or, if Redis isn't configured, immediately runs) a fee
 * reminder job for a branch.
 *
 * Returns either `{ queued: true, jobId }` (Redis configured - actual
 * work happens on a worker process, see workers/notificationWorker.ts)
 * or `{ queued: false, result }` (no Redis - ran inline, exactly like
 * before this phase existed). Callers (feeCollection.controller.ts)
 * use this to decide what HTTP response to send back.
 */
export const enqueueFeeReminders = async (
  branchId: string
): Promise<{ queued: true; jobId: string } | { queued: false; result: FeeReminderResult }> => {
  const queue = getQueue(QUEUE_NAMES.NOTIFICATIONS);

  if (!queue) {
    const result = await sendFeeReminders(branchId);
    return { queued: false, result };
  }

  const job = await queue.add("fee-reminders", { branchId } as FeeReminderJobData);
  return { queued: true, jobId: String(job.id) };
};
