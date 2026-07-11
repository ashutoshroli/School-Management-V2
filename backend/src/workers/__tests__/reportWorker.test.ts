const mockQueue = { process: jest.fn() };

jest.mock("../../queues", () => ({
  getQueue: jest.fn(),
  QUEUE_NAMES: { NOTIFICATIONS: "notifications", REPORTS: "reports" },
}));

jest.mock("../../controllers/feeReports.controller", () => ({
  fetchDefaulters: jest.fn(),
  DEFAULTER_CSV_COLUMNS: [],
}));

jest.mock("../../services/csvExport.service", () => ({
  buildCsv: jest.fn().mockReturnValue("header\r\nrow1"),
}));

jest.mock("../../services/storage.service", () => ({
  storage: { save: jest.fn() },
}));

jest.mock("../../config/logger", () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import { getQueue } from "../../queues";
import { fetchDefaulters } from "../../controllers/feeReports.controller";
import { storage } from "../../services/storage.service";
import { logger } from "../../config/logger";
import { startReportWorker } from "../reportWorker";

describe("startReportWorker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("logs a warning and registers nothing when no queue is available", () => {
    (getQueue as jest.Mock).mockReturnValue(null);

    startReportWorker();

    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/not started/i));
  });

  it("registers a processor for the defaulters-csv job type when a queue is available", () => {
    (getQueue as jest.Mock).mockReturnValue(mockQueue);

    startReportWorker();

    expect(mockQueue.process).toHaveBeenCalledWith("defaulters-csv", expect.any(Function));
  });

  it("the registered processor builds a CSV, saves it, and returns its url + row count", async () => {
    (getQueue as jest.Mock).mockReturnValue(mockQueue);
    (fetchDefaulters as jest.Mock).mockResolvedValue([{ id: "fa-1" }, { id: "fa-2" }]);
    (storage.save as jest.Mock).mockResolvedValue({ url: "/uploads/reports/abc.csv" });

    startReportWorker();
    const processor = mockQueue.process.mock.calls[0][1];

    const result = await processor({ id: "job-1", data: { branchId: "branch-1", classId: "class-1", requestedBy: "user-1" } });

    expect(fetchDefaulters).toHaveBeenCalledWith("branch-1", "class-1");
    expect(storage.save).toHaveBeenCalled();
    expect(result).toEqual({ url: "/uploads/reports/abc.csv", rowCount: 2 });
  });
});
