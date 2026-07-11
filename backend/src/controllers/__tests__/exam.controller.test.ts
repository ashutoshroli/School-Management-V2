import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    gradeSystem: { findMany: jest.fn() },
    mark: { upsert: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { enterMarks } from "../exam.controller";
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

// enterMarks's grade assignment now prefers admin-configured
// GradeSystem bands (see gradeSystem.controller.ts) over the original
// hardcoded A+/A/B+/.../F scale, falling back to that scale only when
// no bands are configured - existing deployments/tests that never
// touch Grade System settings must keep their exact previous behavior.
describe("exam.controller - enterMarks grade lookup", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.mark.upsert as jest.Mock).mockResolvedValue({});
  });

  it("falls back to the hardcoded scale when no grade bands are configured", async () => {
    (prisma.gradeSystem.findMany as jest.Mock).mockResolvedValue([]);
    const req = makeReq({
      body: { examId: "exam-1", subjectId: "sub-1", marks: [{ studentId: "stu-1", maxMarks: 100, obtainedMarks: 95 }] },
    });
    const res = makeMockRes();

    await enterMarks(req, res);

    expect((prisma.mark.upsert as jest.Mock).mock.calls[0][0].create.grade).toBe("A+");
  });

  it("uses a configured grade band's label when the percentage falls within its range", async () => {
    (prisma.gradeSystem.findMany as jest.Mock).mockResolvedValue([
      { id: "g1", minMarks: 91, maxMarks: 100, grade: "A1" },
      { id: "g2", minMarks: 81, maxMarks: 90, grade: "A2" },
    ]);
    const req = makeReq({
      body: { examId: "exam-1", subjectId: "sub-1", marks: [{ studentId: "stu-1", maxMarks: 100, obtainedMarks: 95 }] },
    });
    const res = makeMockRes();

    await enterMarks(req, res);

    expect((prisma.mark.upsert as jest.Mock).mock.calls[0][0].create.grade).toBe("A1");
  });

  it("falls back to the hardcoded scale when configured bands don't cover the percentage", async () => {
    (prisma.gradeSystem.findMany as jest.Mock).mockResolvedValue([{ id: "g1", minMarks: 91, maxMarks: 100, grade: "A1" }]);
    const req = makeReq({
      body: { examId: "exam-1", subjectId: "sub-1", marks: [{ studentId: "stu-1", maxMarks: 100, obtainedMarks: 55 }] },
    });
    const res = makeMockRes();

    await enterMarks(req, res);

    expect((prisma.mark.upsert as jest.Mock).mock.calls[0][0].create.grade).toBe("C");
  });

  it("fetches grade bands only once for a whole batch of students", async () => {
    (prisma.gradeSystem.findMany as jest.Mock).mockResolvedValue([]);
    const req = makeReq({
      body: {
        examId: "exam-1",
        subjectId: "sub-1",
        marks: [
          { studentId: "stu-1", maxMarks: 100, obtainedMarks: 95 },
          { studentId: "stu-2", maxMarks: 100, obtainedMarks: 55 },
        ],
      },
    });
    const res = makeMockRes();

    await enterMarks(req, res);

    expect(prisma.gradeSystem.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.mark.upsert).toHaveBeenCalledTimes(2);
  });
});
