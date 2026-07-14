const mockInit = jest.fn();

jest.mock("@sentry/node", () => ({
  init: mockInit,
}));

jest.mock("dotenv", () => ({
  config: jest.fn(),
}));

describe("instrument (Sentry bootstrap - must run before any other import)", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it("calls Sentry.init with dsn/environment/tracesSampleRate from process.env", () => {
    process.env.SENTRY_DSN = "https://examplePublicKey@o0.ingest.sentry.io/0";
    process.env.NODE_ENV = "production";
    process.env.SENTRY_TRACES_SAMPLE_RATE = "0.25";

    require("../instrument");

    expect(mockInit).toHaveBeenCalledWith({
      dsn: "https://examplePublicKey@o0.ingest.sentry.io/0",
      environment: "production",
      tracesSampleRate: 0.25,
    });
  });

  it("defaults tracesSampleRate to 0.1 when SENTRY_TRACES_SAMPLE_RATE is unset", () => {
    process.env.SENTRY_DSN = "https://examplePublicKey@o0.ingest.sentry.io/0";
    delete process.env.SENTRY_TRACES_SAMPLE_RATE;

    require("../instrument");

    expect(mockInit).toHaveBeenCalledWith(
      expect.objectContaining({ tracesSampleRate: 0.1 })
    );
  });

  it("still calls Sentry.init (which itself no-ops) when SENTRY_DSN is unset, and warns", () => {
    delete process.env.SENTRY_DSN;
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    require("../instrument");

    expect(mockInit).toHaveBeenCalledWith(expect.objectContaining({ dsn: undefined }));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/SENTRY_DSN is not set/));

    warnSpy.mockRestore();
  });
});
