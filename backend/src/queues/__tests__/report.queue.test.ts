jest.mock("../index", () => ({
  getQueue: jest.fn(),
  QUEUE_NAMES: { NOTIFICATIONS: "notifications", REPORTS: "reports" },
}));

import { getQueue } from "../index";
import { enqueueDefaultersCsvExport } from "../report.queue";

describe("enqueueDefaultersCsvExport", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns queued:false when no queue is available", () => {
    (getQueue as jest.Mock).mockReturnValue(null);

    const outcome = enqueueDefaultersCsvExport({ branchId: "branch-1", requestedBy: "user-1" });

    expect(outcome).toEqual({ queued: false });
  });

  it("adds a job to the queue and returns queued:true when a queue is available", () => {
    const mockQueue = { add: jest.fn().mockResolvedValue({ id: "job-456" }) };
    (getQueue as jest.Mock).mockReturnValue(mockQueue);

    const outcome = enqueueDefaultersCsvExport({ branchId: "branch-1", classId: "class-1", requestedBy: "user-1" });

    expect(outcome.queued).toBe(true);
    expect(mockQueue.add).toHaveBeenCalledWith("defaulters-csv", {
      branchId: "branch-1",
      classId: "class-1",
      requestedBy: "user-1",
    });
  });
});
