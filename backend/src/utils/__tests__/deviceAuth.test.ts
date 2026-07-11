jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    attendanceDevice: { findUnique: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { authenticateDevice, extractDeviceApiKey } from "../deviceAuth";

const makeMockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const ACTIVE_DEVICE = {
  id: "device-1",
  branchId: "branch-1",
  deviceId: "device-uuid-1",
  apiKey: "correct-secret-key-0123456789abcdef",
  isActive: true,
};

describe("deviceAuth", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("extractDeviceApiKey", () => {
    it("prefers the X-Device-Api-Key header over the body field", () => {
      const req = { headers: { "x-device-api-key": "header-key" }, body: { apiKey: "body-key" } };
      expect(extractDeviceApiKey(req)).toBe("header-key");
    });

    it("falls back to body.apiKey when no header is present", () => {
      const req = { headers: {}, body: { apiKey: "body-key" } };
      expect(extractDeviceApiKey(req)).toBe("body-key");
    });

    it("returns undefined when neither is present", () => {
      const req = { headers: {}, body: {} };
      expect(extractDeviceApiKey(req)).toBeUndefined();
    });
  });

  describe("authenticateDevice", () => {
    it("SECURITY: rejects when deviceId is present but no apiKey is provided at all", async () => {
      const res = makeMockRes();
      const result = await authenticateDevice("device-uuid-1", undefined, res);

      expect(result).toBeNull();
      expect(res.status).toHaveBeenCalledWith(401);
      // Must never even look up the device without an apiKey present -
      // avoids leaking "device exists" info via response-shape/timing.
      expect(prisma.attendanceDevice.findUnique).not.toHaveBeenCalled();
    });

    it("rejects when deviceId is missing", async () => {
      const res = makeMockRes();
      const result = await authenticateDevice(undefined, "some-key", res);

      expect(result).toBeNull();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("rejects an unknown deviceId", async () => {
      (prisma.attendanceDevice.findUnique as jest.Mock).mockResolvedValue(null);
      const res = makeMockRes();

      const result = await authenticateDevice("unknown-device", "any-key", res);

      expect(result).toBeNull();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("rejects a deactivated device even with the correct apiKey", async () => {
      (prisma.attendanceDevice.findUnique as jest.Mock).mockResolvedValue({ ...ACTIVE_DEVICE, isActive: false });
      const res = makeMockRes();

      const result = await authenticateDevice("device-uuid-1", ACTIVE_DEVICE.apiKey, res);

      expect(result).toBeNull();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("SECURITY: rejects a valid deviceId with the WRONG apiKey", async () => {
      (prisma.attendanceDevice.findUnique as jest.Mock).mockResolvedValue(ACTIVE_DEVICE);
      const res = makeMockRes();

      const result = await authenticateDevice("device-uuid-1", "totally-wrong-key", res);

      expect(result).toBeNull();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("SECURITY: rejects a key that differs in length from the real one (no crash, clean reject)", async () => {
      (prisma.attendanceDevice.findUnique as jest.Mock).mockResolvedValue(ACTIVE_DEVICE);
      const res = makeMockRes();

      const result = await authenticateDevice("device-uuid-1", "short", res);

      expect(result).toBeNull();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("accepts a valid deviceId + matching apiKey and returns the device", async () => {
      (prisma.attendanceDevice.findUnique as jest.Mock).mockResolvedValue(ACTIVE_DEVICE);
      const res = makeMockRes();

      const result = await authenticateDevice("device-uuid-1", ACTIVE_DEVICE.apiKey, res);

      expect(result).toEqual(ACTIVE_DEVICE);
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
