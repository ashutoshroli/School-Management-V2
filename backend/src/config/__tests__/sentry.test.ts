jest.mock("@sentry/node", () => ({
  init: jest.fn(),
  setupExpressErrorHandler: jest.fn(),
  captureException: jest.fn(),
}));

jest.mock("../logger", () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

jest.mock("../index", () => ({
  config: {
    nodeEnv: "test",
    sentry: { dsn: "", tracesSampleRate: 0.1 },
  },
}));

import * as Sentry from "@sentry/node";
import { config } from "../index";
import { logger } from "../logger";
import { isSentryConfigured, setupSentryErrorHandler, captureException } from "../sentry";

describe("sentry config", () => {
  const fakeApp = {} as any;

  beforeEach(() => {
    jest.clearAllMocks();
    (config as any).sentry = { dsn: "", tracesSampleRate: 0.1 };
  });

  describe("isSentryConfigured", () => {
    it("returns false when SENTRY_DSN is not set", () => {
      expect(isSentryConfigured()).toBe(false);
    });

    it("returns true when SENTRY_DSN is set", () => {
      (config as any).sentry.dsn = "https://examplePublicKey@o0.ingest.sentry.io/0";
      expect(isSentryConfigured()).toBe(true);
    });
  });

  describe("setupSentryErrorHandler", () => {
    it("does not register the error handler when not configured, and logs a warning", () => {
      setupSentryErrorHandler(fakeApp);
      expect(Sentry.setupExpressErrorHandler).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/not configured/i));
    });

    it("registers the error handler on the app when configured", () => {
      (config as any).sentry.dsn = "https://examplePublicKey@o0.ingest.sentry.io/0";
      setupSentryErrorHandler(fakeApp);
      expect(Sentry.setupExpressErrorHandler).toHaveBeenCalledWith(fakeApp);
      expect(logger.info).toHaveBeenCalled();
    });
  });

  describe("captureException", () => {
    it("does not call Sentry when not configured", () => {
      captureException(new Error("x"));
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it("forwards the error and extra context to Sentry when configured", () => {
      (config as any).sentry.dsn = "https://examplePublicKey@o0.ingest.sentry.io/0";
      const err = new Error("boom");
      captureException(err, { jobId: "123" });
      expect(Sentry.captureException).toHaveBeenCalledWith(err, { extra: { jobId: "123" } });
    });
  });
});
