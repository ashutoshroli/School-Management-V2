jest.mock("../index", () => ({
  getQueue: jest.fn(),
  QUEUE_NAMES: { NOTIFICATIONS: "notifications", REPORTS: "reports" },
}));

jest.mock("../../services/feeReminder.service", () => ({
  sendFeeReminders: jest.fn(),
}));

import { getQueue } from "../index";
import { sendFeeReminders } from "../../services/feeReminder.service";
import { enqueueFeeReminders } from "../notification.queue";

describe("enqueueFeeReminders", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("runs sendFeeReminders inline and returns queued:false when no queue is available", async () => {
    (getQueue as jest.Mock).mockReturnValue(null);
    (sendFeeReminders as jest.Mock).mockResolvedValue({ totalDefaulters: 2, notified: 2, skipped: 0, errors: [] });

    const outcome = await enqueueFeeReminders("branch-1");

    expect(outcome).toEqual({
      queued: false,
      result: { totalDefaulters: 2, notified: 2, skipped: 0, errors: [] },
    });
    expect(sendFeeReminders).toHaveBeenCalledWith("branch-1");
  });

  it("adds a job to the queue and returns queued:true with a jobId when a queue is available", async () => {
    const mockQueue = { add: jest.fn().mockResolvedValue({ id: "job-123" }) };
    (getQueue as jest.Mock).mockReturnValue(mockQueue);

    const outcome = await enqueueFeeReminders("branch-1");

    expect(outcome).toEqual({ queued: true, jobId: "job-123" });
    expect(mockQueue.add).toHaveBeenCalledWith("fee-reminders", { branchId: "branch-1" });
    expect(sendFeeReminders).not.toHaveBeenCalled();
  });
});
