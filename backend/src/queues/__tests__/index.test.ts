const mockBullInstance = {
  on: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};

jest.mock("bull", () => jest.fn().mockImplementation(() => mockBullInstance));

jest.mock("../../config/redis", () => ({
  isRedisConfigured: jest.fn(),
}));

jest.mock("../../config", () => ({
  config: { redis: { url: "" } },
}));

jest.mock("../../config/logger", () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import Bull from "bull";
import { isRedisConfigured } from "../../config/redis";
import { getQueue, QUEUE_NAMES, closeAllQueues, __resetQueuesForTests } from "../index";

describe("queues/index", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetQueuesForTests();
  });

  it("getQueue returns null when Redis is not configured", () => {
    (isRedisConfigured as jest.Mock).mockReturnValue(false);
    expect(getQueue(QUEUE_NAMES.NOTIFICATIONS)).toBeNull();
    expect(Bull).not.toHaveBeenCalled();
  });

  it("getQueue creates and returns a Bull queue when Redis is configured", () => {
    (isRedisConfigured as jest.Mock).mockReturnValue(true);
    const queue = getQueue(QUEUE_NAMES.NOTIFICATIONS);
    expect(queue).toBe(mockBullInstance);
    expect(Bull).toHaveBeenCalledTimes(1);
  });

  it("getQueue reuses the same queue instance on subsequent calls (does not recreate)", () => {
    (isRedisConfigured as jest.Mock).mockReturnValue(true);
    const first = getQueue(QUEUE_NAMES.REPORTS);
    const second = getQueue(QUEUE_NAMES.REPORTS);
    expect(first).toBe(second);
    expect(Bull).toHaveBeenCalledTimes(1);
  });

  it("getQueue creates separate instances for different queue names", () => {
    (isRedisConfigured as jest.Mock).mockReturnValue(true);
    getQueue(QUEUE_NAMES.NOTIFICATIONS);
    getQueue(QUEUE_NAMES.REPORTS);
    expect(Bull).toHaveBeenCalledTimes(2);
  });

  it("closeAllQueues closes every created queue", async () => {
    (isRedisConfigured as jest.Mock).mockReturnValue(true);
    getQueue(QUEUE_NAMES.NOTIFICATIONS);
    getQueue(QUEUE_NAMES.REPORTS);
    await closeAllQueues();
    expect(mockBullInstance.close).toHaveBeenCalledTimes(2);
  });
});
