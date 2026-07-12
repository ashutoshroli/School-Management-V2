import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    homework: { findUnique: jest.fn() },
    class: { findUnique: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { getHomeworkById } from "../homework.controller";
import { AuthRequest } from "../../types";

const makeMockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const makeReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
  ({
    body: {},
    params: {},
    query: {},
    user: { userId: "teacher-1", email: "t@test.com", role: UserRole.TEACHER, branchId: "branch-1" },
    ...overrides,
  } as any);

// Homework has no branchId of its own - branch-scoping is checked via
// its Class relation instead (same pattern as getExamById follows for
// Exam), a relation not otherwise loaded by getHomeworks's list view.
describe("homework.controller - getHomeworkById", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 404 when the homework does not exist", async () => {
    (prisma.homework.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { id: "hw-1" } });
    const res = makeMockRes();

    await getHomeworkById(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.class.findUnique).not.toHaveBeenCalled();
  });

  it("SECURITY: rejects homework whose class belongs to a DIFFERENT branch", async () => {
    (prisma.homework.findUnique as jest.Mock).mockResolvedValue({ id: "hw-1", classId: "class-1", submissions: [] });
    (prisma.class.findUnique as jest.Mock).mockResolvedValue({ branchId: "branch-OTHER", name: "Class 5" });
    const req = makeReq({ params: { id: "hw-1" } });
    const res = makeMockRes();

    await getHomeworkById(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 404 when the homework's class no longer exists", async () => {
    (prisma.homework.findUnique as jest.Mock).mockResolvedValue({ id: "hw-1", classId: "class-1", submissions: [] });
    (prisma.class.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { id: "hw-1" } });
    const res = makeMockRes();

    await getHomeworkById(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns the homework with its submission list when in the caller's branch", async () => {
    (prisma.homework.findUnique as jest.Mock).mockResolvedValue({
      id: "hw-1",
      classId: "class-1",
      title: "Algebra worksheet",
      submissions: [{ id: "sub-1", student: { user: { name: "Ravi" } } }],
    });
    (prisma.class.findUnique as jest.Mock).mockResolvedValue({ branchId: "branch-1", name: "Class 5" });
    const req = makeReq({ params: { id: "hw-1" } });
    const res = makeMockRes();

    await getHomeworkById(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(payload.submissions).toHaveLength(1);
    expect(payload.class).toEqual({ branchId: "branch-1", name: "Class 5" });
  });
});
