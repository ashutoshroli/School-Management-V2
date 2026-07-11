import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    staff: { findUnique: jest.fn() },
    class: { findUnique: jest.fn() },
    student: { findMany: jest.fn() },
  },
}));

// startPdfResponse normally pipes a real PDFKit document to an HTTP
// response stream - for these access-control-focused tests we mock it
// to return a minimal fake "doc" so we can assert whether rendering was
// attempted at all, without needing a real writable stream. The
// drawing helpers (drawHeader/drawFooter/etc) are far more useful to
// test for real (see certificateGenerator.service.test.ts's approach)
// but this controller's interesting *behavior* to verify here is
// access control (who gets a 404 vs an actual card), not pixel layout.
jest.mock("../../services/pdf.service", () => {
  const actual = jest.requireActual("../../services/pdf.service");
  const makeFakeDoc = () => ({
    page: { width: 595, height: 842, margins: { left: 40, right: 40, top: 40, bottom: 40 } },
    roundedRect: jest.fn().mockReturnThis(),
    fillAndStroke: jest.fn().mockReturnThis(),
    fontSize: jest.fn().mockReturnThis(),
    fillColor: jest.fn().mockReturnThis(),
    text: jest.fn().mockReturnThis(),
    moveTo: jest.fn().mockReturnThis(),
    lineTo: jest.fn().mockReturnThis(),
    strokeColor: jest.fn().mockReturnThis(),
    stroke: jest.fn().mockReturnThis(),
    rect: jest.fn().mockReturnThis(),
    fill: jest.fn().mockReturnThis(),
    moveDown: jest.fn().mockReturnThis(),
    addPage: jest.fn().mockReturnThis(),
    end: jest.fn(),
    y: 100,
  });
  return { ...actual, startPdfResponse: jest.fn(() => makeFakeDoc()) };
});

import prisma from "../../config/database";
import { startPdfResponse } from "../../services/pdf.service";
import { getStaffIdCardPdf, getClassIdCardsBatchPdf } from "../document.controller";
import { AuthRequest } from "../../types";

const makeMockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn();
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

describe("document.controller - ID card access control", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getStaffIdCardPdf", () => {
    const makeStaff = (branchId: string, userId = "staff-user-1") => ({
      id: "staff-1",
      employeeId: "EMP-0001",
      branchId,
      designation: "PGT",
      department: "Science",
      user: { id: userId, name: "Jane Teacher" },
      branch: { name: "ABC School" },
    });

    it("returns 404 for a staff member in a different branch when caller is not that staff member", async () => {
      (prisma.staff.findUnique as jest.Mock).mockResolvedValue(makeStaff("branch-OTHER"));

      const req = makeReq({ params: { id: "staff-1" } });
      const res = makeMockRes();

      await getStaffIdCardPdf(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(startPdfResponse).not.toHaveBeenCalled();
    });

    it("allows a branch admin to download a card for staff within their own branch", async () => {
      (prisma.staff.findUnique as jest.Mock).mockResolvedValue(makeStaff("branch-1"));

      const req = makeReq({ params: { id: "staff-1" } });
      const res = makeMockRes();

      await getStaffIdCardPdf(req, res);

      expect(startPdfResponse).toHaveBeenCalled();
    });

    it("SECURITY: allows a staff member to download their OWN card via the isSelf check, even when canAccessBranch alone would deny it", async () => {
      // Deliberately mismatched branchId (staff record's branch vs the
      // requester's own branchId) so canAccessBranch() by itself would
      // return false - only the isSelf override should let this through.
      (prisma.staff.findUnique as jest.Mock).mockResolvedValue(makeStaff("branch-A", "self-user-1"));

      const req = makeReq({
        params: { id: "staff-1" },
        user: { userId: "self-user-1", email: "self@test.com", role: UserRole.TEACHER, branchId: "branch-B" },
      });
      const res = makeMockRes();

      await getStaffIdCardPdf(req, res);

      expect(startPdfResponse).toHaveBeenCalled();
    });

    it("does NOT let an arbitrary teacher (not the card's owner, not branch-scoped) download someone else's card", async () => {
      (prisma.staff.findUnique as jest.Mock).mockResolvedValue(makeStaff("branch-1", "other-staff-user"));

      const req = makeReq({
        params: { id: "staff-1" },
        user: { userId: "different-teacher", email: "t@test.com", role: UserRole.TEACHER, branchId: "branch-OTHER" },
      });
      const res = makeMockRes();

      await getStaffIdCardPdf(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(startPdfResponse).not.toHaveBeenCalled();
    });

    it("returns 404 when the staff record does not exist", async () => {
      (prisma.staff.findUnique as jest.Mock).mockResolvedValue(null);

      const req = makeReq({ params: { id: "missing" } });
      const res = makeMockRes();

      await getStaffIdCardPdf(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe("getClassIdCardsBatchPdf", () => {
    it("returns 400 when classId query param is missing", async () => {
      const req = makeReq({ query: {} });
      const res = makeMockRes();

      await getClassIdCardsBatchPdf(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(prisma.class.findUnique).not.toHaveBeenCalled();
    });

    it("returns 404 for a class in a different branch (IDOR guard)", async () => {
      (prisma.class.findUnique as jest.Mock).mockResolvedValue({ branchId: "branch-OTHER", name: "Class 5" });

      const req = makeReq({ query: { classId: "class-1" } });
      const res = makeMockRes();

      await getClassIdCardsBatchPdf(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(prisma.student.findMany).not.toHaveBeenCalled();
    });

    it("returns 404 when no active students are found for the class", async () => {
      (prisma.class.findUnique as jest.Mock).mockResolvedValue({ branchId: "branch-1", name: "Class 5" });
      (prisma.student.findMany as jest.Mock).mockResolvedValue([]);

      const req = makeReq({ query: { classId: "class-1" } });
      const res = makeMockRes();

      await getClassIdCardsBatchPdf(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(startPdfResponse).not.toHaveBeenCalled();
    });

    it("renders one card per student, calling addPage() between each after the first", async () => {
      (prisma.class.findUnique as jest.Mock).mockResolvedValue({ branchId: "branch-1", name: "Class 5" });
      (prisma.student.findMany as jest.Mock).mockResolvedValue([
        { id: "s1", admissionNo: "A1", rollNo: "1", bloodGroup: "O+", user: { name: "Student One" }, class: { name: "5" }, section: { name: "A" }, branch: { name: "ABC" } },
        { id: "s2", admissionNo: "A2", rollNo: "2", bloodGroup: null, user: { name: "Student Two" }, class: { name: "5" }, section: { name: "A" }, branch: { name: "ABC" } },
        { id: "s3", admissionNo: "A3", rollNo: "3", bloodGroup: null, user: { name: "Student Three" }, class: { name: "5" }, section: { name: "A" }, branch: { name: "ABC" } },
      ]);

      const req = makeReq({ query: { classId: "class-1" } });
      const res = makeMockRes();

      await getClassIdCardsBatchPdf(req, res);

      const doc = (startPdfResponse as jest.Mock).mock.results[0].value;
      expect(doc.addPage).toHaveBeenCalledTimes(2); // 3 students -> 2 page breaks
      expect(doc.end).toHaveBeenCalled();
    });
  });
});
