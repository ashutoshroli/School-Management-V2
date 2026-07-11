import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    studentAttendance: { findMany: jest.fn() },
    student: { findMany: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { getAttendanceDefaultersList, exportAttendanceDefaultersCsv } from "../reports.controller";
import { AuthRequest } from "../../types";

const makeMockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn();
  res.send = jest.fn();
  return res;
};

const makeReq = (overrides: Partial<AuthRequest> = {}): AuthRequest =>
  ({
    body: {},
    params: {},
    query: {},
    user: { userId: "admin-1", email: "admin@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" },
    ...overrides,
  } as any);

const makeStudent = (name: string, presentDays: number, workingDays: number) => ({
  id: `student-${name}`,
  admissionNo: `A-${name}`,
  user: { name, phone: "9876543210" },
  class: { name: "Class 5" },
  section: { name: "A" },
  attendances: Array.from({ length: presentDays }, () => ({ status: "PRESENT" })).concat(
    Array.from({ length: workingDays - presentDays }, () => ({ status: "ABSENT" }))
  ),
});

describe("reports.controller - attendance defaulters (Phase 6)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getAttendanceDefaultersList", () => {
    it("requires a resolvable branchId", async () => {
      const req = makeReq({ user: { userId: "u1", email: "e", role: UserRole.SUPER_ADMIN } });
      const res = makeMockRes();

      await getAttendanceDefaultersList(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("returns an empty list with a friendly message when no attendance has been recorded yet", async () => {
      (prisma.studentAttendance.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.student.findMany as jest.Mock).mockResolvedValue([]);

      const req = makeReq();
      const res = makeMockRes();

      await getAttendanceDefaultersList(req, res);

      const [payload] = (res.json as jest.Mock).mock.calls[0];
      expect(payload.data).toEqual({ students: [], workingDays: 0, threshold: 75 });
    });

    it("filters out students at or above the threshold, keeping only those below it", async () => {
      (prisma.studentAttendance.findMany as jest.Mock).mockResolvedValue([
        { date: new Date("2025-06-01") },
        { date: new Date("2025-06-02") },
        { date: new Date("2025-06-03") },
        { date: new Date("2025-06-04") },
      ]); // 4 distinct working days
      (prisma.student.findMany as jest.Mock).mockResolvedValue([
        makeStudent("GoodAttendance", 4, 4), // 100%
        makeStudent("PoorAttendance", 1, 4), // 25%
      ]);

      const req = makeReq({ query: { threshold: "75" } });
      const res = makeMockRes();

      await getAttendanceDefaultersList(req, res);

      const [payload] = (res.json as jest.Mock).mock.calls[0];
      expect(payload.data.students).toHaveLength(1);
      expect(payload.data.students[0].name).toBe("PoorAttendance");
      expect(payload.data.students[0].percentage).toBe(25);
    });

    it("clamps an out-of-range threshold query param into [0, 100]", async () => {
      (prisma.studentAttendance.findMany as jest.Mock).mockResolvedValue([{ date: new Date("2025-06-01") }]);
      (prisma.student.findMany as jest.Mock).mockResolvedValue([]);

      const req = makeReq({ query: { threshold: "500" } });
      const res = makeMockRes();

      await getAttendanceDefaultersList(req, res);

      const [payload] = (res.json as jest.Mock).mock.calls[0];
      expect(payload.data.threshold).toBe(100);
    });

    it("sorts results ascending by percentage (worst attendance first)", async () => {
      (prisma.studentAttendance.findMany as jest.Mock).mockResolvedValue([
        { date: new Date("2025-06-01") },
        { date: new Date("2025-06-02") },
        { date: new Date("2025-06-03") },
        { date: new Date("2025-06-04") },
      ]);
      (prisma.student.findMany as jest.Mock).mockResolvedValue([
        makeStudent("FiftyPercent", 2, 4),
        makeStudent("TwentyFivePercent", 1, 4),
      ]);

      const req = makeReq({ query: { threshold: "100" } });
      const res = makeMockRes();

      await getAttendanceDefaultersList(req, res);

      const [payload] = (res.json as jest.Mock).mock.calls[0];
      expect(payload.data.students[0].name).toBe("TwentyFivePercent");
      expect(payload.data.students[1].name).toBe("FiftyPercent");
    });
  });

  describe("exportAttendanceDefaultersCsv", () => {
    it("returns a CSV attachment with the correct headers and content", async () => {
      (prisma.studentAttendance.findMany as jest.Mock).mockResolvedValue([{ date: new Date("2025-06-01") }, { date: new Date("2025-06-02") }]);
      (prisma.student.findMany as jest.Mock).mockResolvedValue([makeStudent("PoorAttendance", 1, 2)]);

      const req = makeReq();
      const res = makeMockRes();

      await exportAttendanceDefaultersCsv(req, res);

      expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/csv; charset=utf-8");
      const sentBody = (res.send as jest.Mock).mock.calls[0][0];
      expect(sentBody).toContain("PoorAttendance");
      expect(sentBody).toContain("50"); // 1/2 = 50%
    });

    it("requires a resolvable branchId", async () => {
      const req = makeReq({ user: { userId: "u1", email: "e", role: UserRole.SUPER_ADMIN } });
      const res = makeMockRes();

      await exportAttendanceDefaultersCsv(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(prisma.student.findMany).not.toHaveBeenCalled();
    });
  });
});
