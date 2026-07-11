import { logger, logError } from "../logger";

describe("logger", () => {
  it("exports a winston-compatible logger with standard level methods", () => {
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("does not throw when logging at any level", () => {
    expect(() => logger.info("test info")).not.toThrow();
    expect(() => logger.warn("test warn")).not.toThrow();
    expect(() => logger.error("test error")).not.toThrow();
    expect(() => logger.debug("test debug")).not.toThrow();
  });

  describe("logError", () => {
    it("logs an Error instance with message and stack in meta", () => {
      const spy = jest.spyOn(logger, "error").mockImplementation(() => logger);

      const err = new Error("boom");
      logError("Something failed", err, { userId: "u1" });

      expect(spy).toHaveBeenCalledWith(
        "Something failed",
        expect.objectContaining({ errorMessage: "boom", stack: err.stack, userId: "u1" })
      );
      spy.mockRestore();
    });

    it("logs a non-Error thrown value by stringifying it", () => {
      const spy = jest.spyOn(logger, "error").mockImplementation(() => logger);

      logError("Weird failure", "just a string reason");

      expect(spy).toHaveBeenCalledWith("Weird failure", expect.objectContaining({ errorMessage: "just a string reason" }));
      spy.mockRestore();
    });
  });
});
