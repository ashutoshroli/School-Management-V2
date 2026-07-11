describe("swagger docs config", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  describe("isDocsEnabled", () => {
    it("is enabled by default outside production", () => {
      process.env.NODE_ENV = "development";
      delete process.env.DOCS_ENABLED;
      const { isDocsEnabled } = require("../swagger");
      expect(isDocsEnabled()).toBe(true);
    });

    it("is disabled by default in production", () => {
      process.env.NODE_ENV = "production";
      delete process.env.DOCS_ENABLED;
      const { isDocsEnabled } = require("../swagger");
      expect(isDocsEnabled()).toBe(false);
    });

    it("can be force-enabled in production via DOCS_ENABLED=true", () => {
      process.env.NODE_ENV = "production";
      process.env.DOCS_ENABLED = "true";
      const { isDocsEnabled } = require("../swagger");
      expect(isDocsEnabled()).toBe(true);
    });

    it("can be force-disabled outside production via DOCS_ENABLED=false", () => {
      process.env.NODE_ENV = "development";
      process.env.DOCS_ENABLED = "false";
      const { isDocsEnabled } = require("../swagger");
      expect(isDocsEnabled()).toBe(false);
    });
  });

  describe("swaggerSpec", () => {
    it("generates a valid OpenAPI 3.0 spec with the expected title and security scheme", () => {
      const { swaggerSpec } = require("../swagger");
      expect(swaggerSpec.openapi).toBe("3.0.0");
      expect(swaggerSpec.info.title).toBe("School ERP API");
      expect(swaggerSpec.components.securitySchemes.bearerAuth).toEqual(
        expect.objectContaining({ type: "http", scheme: "bearer" })
      );
    });

    it("includes the shared common + auth schemas", () => {
      const { swaggerSpec } = require("../swagger");
      expect(swaggerSpec.components.schemas).toHaveProperty("SuccessResponse");
      expect(swaggerSpec.components.schemas).toHaveProperty("ErrorResponse");
      expect(swaggerSpec.components.schemas).toHaveProperty("LoginRequest");
      expect(swaggerSpec.components.schemas).toHaveProperty("UserSummary");
    });

    it("picks up @swagger JSDoc annotations from auth.routes.ts", () => {
      const { swaggerSpec } = require("../swagger");
      expect(swaggerSpec.paths).toHaveProperty("/auth/login");
      expect(swaggerSpec.paths["/auth/login"]).toHaveProperty("post");
    });
  });
});
