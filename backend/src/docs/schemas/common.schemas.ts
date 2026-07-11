/**
 * Shared response envelope schemas (Phase 6 API docs) - every endpoint
 * in this API responds via utils/response.ts's sendSuccess/sendError/
 * sendPaginated helpers, so these three shapes cover the "outer" shape
 * of literally every response; individual endpoints' @swagger blocks
 * only need to describe their own `data` payload on top of these.
 */
export const commonSchemas = {
  SuccessResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      message: { type: "string", example: "Operation successful" },
      data: { type: "object" },
    },
  },
  ErrorResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: false },
      message: { type: "string", example: "Something went wrong" },
      error: { type: "string", nullable: true, example: "Detailed error message (non-production only)" },
    },
  },
  PaginatedResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      message: { type: "string" },
      data: { type: "array", items: {} },
      pagination: {
        type: "object",
        properties: {
          total: { type: "integer", example: 42 },
          page: { type: "integer", example: 1 },
          limit: { type: "integer", example: 20 },
          totalPages: { type: "integer", example: 3 },
        },
      },
    },
  },
};
