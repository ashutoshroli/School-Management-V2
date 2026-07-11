import { Job } from "bull";
import { getQueue, QUEUE_NAMES } from "../queues";
import { FeeReminderJobData } from "../queues/notification.queue";
import { sendFeeReminders } from "../services/feeReminder.service";
import { logger } from "../config/logger";

/**
 * Registers the processor for the "notifications" queue on THIS
 * process. Must be called from a separate worker process (see
 * workers/index.ts), never from the API server's own process/app.ts -
 * see queues/index.ts's header comment for why.
 */
export const startNotificationWorker = (): void => {
  const queue = getQueue(QUEUE_NAMES.NOTIFICATIONS);
  if (!queue) {
    logger.warn('Notification worker not started: Redis is not configured (REDIS_URL unset)');
    return;
  }

  queue.process("fee-reminders", async (job: Job<FeeReminderJobData>) => {
    logger.info("Processing fee-reminders job", { jobId: job.id, branchId: job.data.branchId });
    const result = await sendFeeReminders(job.data.branchId);
    logger.info("Fee-reminders job complete", { jobId: job.id, ...result });
    return result;
  });

  logger.info('Notification worker started (queue: "notifications")');
};
