/** Auth module request/response schemas (Phase 6 API docs). */
export const authSchemas = {
  LoginRequest: {
    type: "object",
    required: ["email", "password"],
    properties: {
      email: { type: "string", format: "email", example: "branchadmin@abcschool.edu.in" },
      password: { type: "string", format: "password", example: "Admin@123" },
    },
  },
  LoginResponseData: {
    type: "object",
    properties: {
      token: { type: "string", description: "JWT to send as a Bearer token on subsequent requests." },
      user: { $ref: "#/components/schemas/UserSummary" },
    },
  },
  UserSummary: {
    type: "object",
    properties: {
      id: { type: "string", example: "cly1a2b3c" },
      email: { type: "string", example: "branchadmin@abcschool.edu.in" },
      name: { type: "string", example: "Branch Administrator" },
      role: {
        type: "string",
        enum: [
          "SUPER_ADMIN",
          "BRANCH_ADMIN",
          "TEACHER",
          "ACCOUNTANT",
          "LIBRARIAN",
          "TRANSPORT_MANAGER",
          "WARDEN",
          "STAFF",
          "STUDENT",
          "PARENT",
        ],
      },
      avatar: { type: "string", nullable: true },
    },
  },
  ChangePasswordRequest: {
    type: "object",
    required: ["currentPassword", "newPassword"],
    properties: {
      currentPassword: { type: "string", format: "password" },
      newPassword: {
        type: "string",
        format: "password",
        description: "Minimum 8 characters, must contain an uppercase letter and a number.",
      },
    },
  },
  SwitchBranchRequest: {
    type: "object",
    required: ["branchId"],
    properties: {
      branchId: { type: "string", example: "branch-main" },
    },
  },
};
