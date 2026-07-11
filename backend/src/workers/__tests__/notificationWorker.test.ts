const mockQueue = { process: jest.fn() };

jest.mock("../../queues", () => ({
  getQueue: jest.fn(),
  QUEUE_NAMES: { NOTIFICATIONS: "notifications", REPORTS: "reports" },
}));

jest.mock("../../services/feeReminder.service", () => ({
  sendFeeReminders: jest.fn(),
}));

jest.mock("../../config/logger", () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import { getQueue } from "../../queues";
import { sendFeeReminders } from "../../services/feeReminder.service";
import { logger } from "../../config/logger";
import { startNotificationWorker } from "../notificationWorker";

describe("startNotificationWorker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("logs a warning and registers nothing when no queue is available", () => {
    (getQueue as jest.Mock).mockReturnValue(null);

    startNotificationWorker();

    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/not started/i));
  });

  it("registers a processor for the fee-reminders job type when a queue is available", () => {
    (getQueue as jest.Mock).mockReturnValue(mockQueue);

    startNotificationWorker();

    expect(mockQueue.process).toHaveBeenCalledWith("fee-reminders", expect.any(Function));
  });

  it("the registered processor calls sendFeeReminders with the job's branchId", async () => {
    (getQueue as jest.Mock).mockReturnValue(mockQueue);
    (sendFeeReminders as jest.Mock).mockResolvedValue({ totalDefaulters: 1, notified: 1, skipped: 0, errors: [] });

    startNotificationWorker();
    const processor = mockQueue.process.mock.calls[0][1];

    const result = await processor({ id: "job-1", data: { branchId: "branch-1" } });

    expect(sendFeeReminders).toHaveBeenCalledWith("branch-1");
    expect(result).toEqual({ totalDefaulters: 1, notified: 1, skipped: 0, errors: [] });
  });
});
