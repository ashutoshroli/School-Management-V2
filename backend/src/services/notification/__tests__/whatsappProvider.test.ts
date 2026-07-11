import { postJson } from "../../../utils/httpClient";

jest.mock("../../../utils/httpClient", () => ({
  postJson: jest.fn(),
}));

jest.mock("../../../config", () => ({
  config: {
    whatsapp: { apiKey: "", apiUrl: "https://api.interakt.ai/v1/public" },
  },
}));

import { config } from "../../../config";
import { isWhatsappConfigured, sendWhatsapp, sendWhatsappTemplate } from "../whatsappProvider";

describe("whatsappProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (config as any).whatsapp = { apiKey: "", apiUrl: "https://api.interakt.ai/v1/public" };
  });

  describe("isWhatsappConfigured", () => {
    it("returns false without an API key", () => {
      expect(isWhatsappConfigured()).toBe(false);
    });

    it("returns true when both API key and URL are set", () => {
      (config as any).whatsapp.apiKey = "key";
      expect(isWhatsappConfigured()).toBe(true);
    });
  });

  describe("sendWhatsapp", () => {
    it("throws when not configured", async () => {
      await expect(sendWhatsapp({ to: "9876543210", body: "hi" })).rejects.toThrow(/not configured/);
      expect(postJson).not.toHaveBeenCalled();
    });

    it("sends a free-text message with normalized phone number", async () => {
      (config as any).whatsapp.apiKey = "key";
      (postJson as jest.Mock).mockResolvedValue({ result: true });

      await sendWhatsapp({ to: "9876543210", body: "Hello parent" });

      expect(postJson).toHaveBeenCalledWith(
        "https://api.interakt.ai/v1/public/message/",
        expect.objectContaining({
          countryCode: "+91",
          phoneNumber: "9876543210",
          type: "Text",
          message: "Hello parent",
        }),
        expect.objectContaining({ headers: { Authorization: "Basic key" } })
      );
    });
  });

  describe("sendWhatsappTemplate", () => {
    it("sends a template message with positional body values", async () => {
      (config as any).whatsapp.apiKey = "key";
      (postJson as jest.Mock).mockResolvedValue({});

      await sendWhatsappTemplate("9876543210", "fee_reminder", ["John", "500"]);

      expect(postJson).toHaveBeenCalledWith(
        "https://api.interakt.ai/v1/public/message/",
        expect.objectContaining({
          type: "Template",
          template: { name: "fee_reminder", languageCode: "en", bodyValues: ["John", "500"] },
        }),
        expect.anything()
      );
    });

    it("throws when not configured", async () => {
      await expect(sendWhatsappTemplate("9876543210", "tmpl", [])).rejects.toThrow(/not configured/);
    });
  });
});
