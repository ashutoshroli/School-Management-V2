import { postJson } from "../../../utils/httpClient";

jest.mock("../../../utils/httpClient", () => ({
  postJson: jest.fn(),
}));

// config is read at call-time (not module-load time) by smsProvider, so
// mutating process.env in each test and re-requiring isn't needed - we
// instead mock the config module directly for full control.
jest.mock("../../../config", () => ({
  config: {
    sms: { apiKey: "", senderId: "SCHLRP", templateId: "", route: "4" },
  },
}));

import { config } from "../../../config";
import { isSmsConfigured, sendSms, sendSmsWithTemplate } from "../smsProvider";

describe("smsProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (config as any).sms = { apiKey: "", senderId: "SCHLRP", templateId: "", route: "4" };
  });

  describe("isSmsConfigured", () => {
    it("returns false when no API key is set", () => {
      expect(isSmsConfigured()).toBe(false);
    });

    it("returns true when an API key is set", () => {
      (config as any).sms.apiKey = "test-key";
      expect(isSmsConfigured()).toBe(true);
    });
  });

  describe("sendSms", () => {
    it("throws when SMS is not configured", async () => {
      await expect(sendSms({ to: "9876543210", body: "hello" })).rejects.toThrow(/not configured/);
      expect(postJson).not.toHaveBeenCalled();
    });

    it("sends a plain-text flow request when no template is configured", async () => {
      (config as any).sms.apiKey = "test-key";
      (postJson as jest.Mock).mockResolvedValue({ type: "success" });

      await sendSms({ to: "9876543210", body: "Fee due" });

      expect(postJson).toHaveBeenCalledWith(
        "https://control.msg91.com/api/v5/flow/",
        expect.objectContaining({
          sender: "SCHLRP",
          sms: [{ message: "Fee due", to: ["919876543210"] }],
        }),
        expect.objectContaining({ headers: { authkey: "test-key" } })
      );
    });

    it("normalizes a 10-digit Indian mobile number by prefixing 91", async () => {
      (config as any).sms.apiKey = "test-key";
      (postJson as jest.Mock).mockResolvedValue({});

      await sendSms({ to: "9876543210", body: "hi" });

      const [, payload] = (postJson as jest.Mock).mock.calls[0];
      expect(payload.sms[0].to[0]).toBe("919876543210");
    });

    it("uses the template path when SMS_TEMPLATE_ID is configured", async () => {
      (config as any).sms.apiKey = "test-key";
      (config as any).sms.templateId = "tmpl-123";
      (postJson as jest.Mock).mockResolvedValue({});

      await sendSms({ to: "9876543210", body: "Fee due" });

      expect(postJson).toHaveBeenCalledWith(
        "https://control.msg91.com/api/v5/flow/",
        expect.objectContaining({ template_id: "tmpl-123" }),
        expect.anything()
      );
    });
  });

  describe("sendSmsWithTemplate", () => {
    it("throws when no template ID is configured even if API key is set", async () => {
      (config as any).sms.apiKey = "test-key";
      await expect(sendSmsWithTemplate("9876543210", { VAR1: "x" })).rejects.toThrow(/SMS_TEMPLATE_ID/);
    });

    it("sends recipients with merged template variables", async () => {
      (config as any).sms.apiKey = "test-key";
      (config as any).sms.templateId = "tmpl-123";
      (postJson as jest.Mock).mockResolvedValue({});

      await sendSmsWithTemplate("9876543210", { VAR1: "John", VAR2: "500" });

      const [, payload] = (postJson as jest.Mock).mock.calls[0];
      expect(payload.recipients[0]).toEqual(
        expect.objectContaining({ mobiles: "919876543210", VAR1: "John", VAR2: "500" })
      );
    });
  });
});
