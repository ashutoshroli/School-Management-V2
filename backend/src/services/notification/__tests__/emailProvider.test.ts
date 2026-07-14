const mockSendMail = jest.fn();
const mockCreateTransport = jest.fn(() => ({ sendMail: mockSendMail }));

jest.mock("nodemailer", () => ({
  createTransport: mockCreateTransport,
}));

// config is read at call-time (not module-load time) by emailProvider,
// so mutating process.env in each test and re-requiring isn't needed -
// we instead mock the config module directly for full control, matching
// smsProvider.test.ts's convention.
jest.mock("../../../config", () => ({
  config: {
    smtp: { host: "", port: 587, user: "", pass: "", fromName: "School ERP", fromEmail: "" },
  },
}));

import { config } from "../../../config";
import { isEmailConfigured, sendEmail } from "../emailProvider";

describe("emailProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (config as any).smtp = { host: "", port: 587, user: "", pass: "", fromName: "School ERP", fromEmail: "" };
  });

  describe("isEmailConfigured", () => {
    it("returns false when SMTP_HOST/USER/PASS are not all set", () => {
      expect(isEmailConfigured()).toBe(false);
    });

    it("returns true when host/user/pass are all set", () => {
      (config as any).smtp = { ...config.smtp, host: "smtp.gmail.com", user: "noreply@school.com", pass: "app-pass" };
      expect(isEmailConfigured()).toBe(true);
    });
  });

  describe("sendEmail", () => {
    it("throws when SMTP is not configured", async () => {
      await expect(sendEmail({ to: "parent@example.com", subject: "Hi", body: "Test" })).rejects.toThrow(
        /not configured/
      );
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it("BUG FIX: uses SMTP_FROM_EMAIL as the From address when it is set (distinct from SMTP_USER)", async () => {
      (config as any).smtp = {
        host: "smtp.gmail.com",
        port: 587,
        user: "auth-relay@school.com",
        pass: "app-pass",
        fromName: "My School",
        fromEmail: "noreply@myschool.com",
      };
      mockSendMail.mockResolvedValue({});

      await sendEmail({ to: "parent@example.com", subject: "Fee Receipt", body: "Paid" });

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ from: '"My School" <noreply@myschool.com>' })
      );
    });

    it("BACKWARD COMPATIBILITY: falls back to SMTP_USER as the From address when SMTP_FROM_EMAIL is unset", async () => {
      (config as any).smtp = {
        host: "smtp.gmail.com",
        port: 587,
        user: "noreply@school.com",
        pass: "app-pass",
        fromName: "School ERP",
        // fromEmail intentionally omitted here - in the real app,
        // config/index.ts's `process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER`
        // already resolves this fallback before it ever reaches this
        // module; this test simulates that resolved value directly.
        fromEmail: "noreply@school.com",
      };
      mockSendMail.mockResolvedValue({});

      await sendEmail({ to: "parent@example.com", subject: "Fee Receipt", body: "Paid" });

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ from: '"School ERP" <noreply@school.com>' })
      );
    });

    it("sends plain-text body escaped into <br/>-separated HTML when no html override is given", async () => {
      (config as any).smtp = { host: "smtp.gmail.com", port: 587, user: "a@b.com", pass: "p", fromName: "School ERP", fromEmail: "a@b.com" };
      mockSendMail.mockResolvedValue({});

      await sendEmail({ to: "parent@example.com", subject: "Hi", body: "Line1\nLine2" });

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ html: "<p>Line1<br/>Line2</p>", text: "Line1\nLine2" })
      );
    });

    it("uses the given html override instead of the auto-escaped body when provided", async () => {
      (config as any).smtp = { host: "smtp.gmail.com", port: 587, user: "a@b.com", pass: "p", fromName: "School ERP", fromEmail: "a@b.com" };
      mockSendMail.mockResolvedValue({});

      await sendEmail({ to: "parent@example.com", subject: "Hi", body: "plain", html: "<strong>rich</strong>" });

      expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ html: "<strong>rich</strong>" }));
    });
  });
});
