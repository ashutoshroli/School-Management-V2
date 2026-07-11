import swaggerJsdoc from "swagger-jsdoc";
import { config } from "../config";

/**
 * OpenAPI/Swagger documentation (Phase 6).
 *
 * Uses swagger-jsdoc's JSDoc-comment approach rather than hand-writing
 * a giant YAML spec - endpoint docs live as `@swagger` JSDoc blocks
 * directly above each route definition (see routes/auth.routes.ts for
 * the first fully-documented module), so the docs sit next to the code
 * they describe and are far more likely to get updated alongside it.
 * Reusable request/response schemas live in docs/schemas/*.ts and are
 * merged into `components.schemas` below - these are added
 * incrementally per module, not meant to cover every endpoint from day
 * one.
 *
 * Served at GET /api/docs (Swagger UI) and GET /api/docs.json (raw
 * spec) - see app.ts for the mount. Entirely additive: no existing
 * route/response shape changes because of this.
 */

import { authSchemas } from "./schemas/auth.schemas";
import { commonSchemas } from "./schemas/common.schemas";

const swaggerDefinition: swaggerJsdoc.OAS3Definition = {
  openapi: "3.0.0",
  info: {
    title: "School ERP API",
    version: "1.0.0",
    description:
      "Multi-branch, multi-tenant School Management System API. " +
      "Most endpoints require a Bearer JWT (see /auth/login) and are " +
      "scoped to the caller's branch - see the `branchAccess` middleware " +
      "and `resolveEffectiveBranchId`/`canAccessBranch` helpers referenced " +
      "throughout the backend source for exactly how that scoping works.",
  },
  servers: [
    {
      url: "/api",
      description: "Current server (relative - works in any environment)",
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: 'Obtain a token from POST /auth/login, then send it as "Authorization: Bearer <token>".',
      },
    },
    schemas: {
      ...commonSchemas,
      ...authSchemas,
    },
  },
  security: [{ bearerAuth: [] }],
};

const options: swaggerJsdoc.Options = {
  definition: swaggerDefinition,
  // Only .ts files (not .d.ts/.js) under routes/ - this repo runs
  // ts-node-dev in development and compiled dist/ in production;
  // swagger-jsdoc parses these as plain text for @swagger JSDoc
  // comments, so it works against either .ts source or compiled .js
  // as long as the comments survive (they do - see build config).
  apis: [
    `${__dirname}/../routes/*.routes.ts`,
    `${__dirname}/../routes/*.routes.js`,
  ],
};

export const swaggerSpec = swaggerJsdoc(options);

/** Whether the docs endpoints should actually be mounted - see app.ts. Disabled in production by default (see DOCS_ENABLED in .env.example) since an API surface map is itself information a public deployment may not want to expose. */
export const isDocsEnabled = (): boolean =>
  process.env.DOCS_ENABLED === "true" || (config.nodeEnv !== "production" && process.env.DOCS_ENABLED !== "false");
