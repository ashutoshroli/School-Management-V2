import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    exam: { findUnique: jest.fn() },
    student: { findUnique: jest.fn(), findMany: jest.fn() },
    admitCard: { upsert: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
    examSchedule: { findMany: jest.fn() },
  },
}));

jest.mock("../../services/admitCardEligibility.service", () => ({
  evaluateStudentEligibility: jest.fn(),
}));

jest.mock("../../services/storage.service", () => ({
  storage: { deleteByUrl: jest.fn() },
}));

jest.mock("../../services/templateRenderer.service", () => ({
  renderTemplateToPdf: jest.fn(),
}));

jest.mock("../../services/documentTemplateLookup.service", () => ({
  getActiveDocumentTemplate: jest.fn(),
}));

jest.mock("../../services/pdf.service", () => {
  const actual = jest.requireActual("../../services/pdf.service");
  const makeFakeDoc = () => ({
    page: { width: 595, height: 842, margins: { left: 40, right: 40, top: 40, bottom: 40 } },
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
    image: jest.fn().mockReturnThis(),
    end: jest.fn(),
    y: 100,
  });
  return { ...actual, startPdfResponse: jest.fn(() => makeFakeDoc()) };
});

import prisma from "../../config/database";
import { evaluateStudentEligibility } from "../../services/admitCardEligibility.service";
import { getActiveDocumentTemplate } from "../../services/documentTemplateLookup.service";
import { renderTemplateToPdf } from "../../services/templateRenderer.service";
import {
  generateAdmitCard,
  bulkGenerateAdmitCards,
  getAdmitCards,
  deleteAdmitCard,
  getAdmitCardPdf,
} from "../admitCard.controller";
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

const EXAM = {
  id: "exam-1",
  classId: "class-1",
  class: { id: "class-1", branchId: "branch-1" },
  academicYear: { startDate: new Date("2026-04-01") },
};

describe("admitCard.controller - generateAdmitCard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.exam.findUnique as jest.Mock).mockResolvedValue(EXAM);
    (prisma.student.findUnique as jest.Mock).mockResolvedValue({ id: "stu-1", classId: "class-1", branchId: "branch-1" });
    (prisma.admitCard.upsert as jest.Mock).mockImplementation(({ create }: any) => Promise.resolve({ id: "ac-1", ...create }));
  });

  it("returns 404 when the exam does not exist", async () => {
    (prisma.exam.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { examId: "exam-1" }, body: { studentId: "stu-1" } });
    const res = makeMockRes();

    await generateAdmitCard(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects an exam belonging to a DIFFERENT branch", async () => {
    (prisma.exam.findUnique as jest.Mock).mockResolvedValue({ ...EXAM, class: { branchId: "branch-OTHER" } });
    const req = makeReq({ params: { examId: "exam-1" }, body: { studentId: "stu-1" } });
    const res = makeMockRes();

    await generateAdmitCard(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 404 when the student does not belong to the exam's class", async () => {
    (prisma.student.findUnique as jest.Mock).mockResolvedValue({ id: "stu-1", classId: "class-OTHER", branchId: "branch-1" });
    const req = makeReq({ params: { examId: "exam-1" }, body: { studentId: "stu-1" } });
    const res = makeMockRes();

    await generateAdmitCard(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("generates an ELIGIBLE card with no rules given (default happy path)", async () => {
    const req = makeReq({ params: { examId: "exam-1" }, body: { studentId: "stu-1" } });
    const res = makeMockRes();

    await generateAdmitCard(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(prisma.admitCard.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { examId_studentId: { examId: "exam-1", studentId: "stu-1" } },
        create: expect.objectContaining({ status: "ELIGIBLE", allowedSubjectIds: [] }),
      })
    );
  });

  it("generates a DENIED card (default onIneligible) when the student fails an enabled rule", async () => {
    (evaluateStudentEligibility as jest.Mock).mockResolvedValue({
      eligible: false,
      failures: [{ rule: "ATTENDANCE", message: "Attendance 60.0% - below the 75% requirement" }],
    });
    const req = makeReq({
      params: { examId: "exam-1" },
      body: { studentId: "stu-1", ruleConfig: { minAttendancePercent: 75 } },
    });
    const res = makeMockRes();

    await generateAdmitCard(req, res);

    expect(prisma.admitCard.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: "DENIED", remarks: "Attendance 60.0% - below the 75% requirement" }),
      })
    );
  });

  it("generates a PROVISIONAL card with restricted allowedSubjectIds when onIneligible=PROVISIONAL", async () => {
    (evaluateStudentEligibility as jest.Mock).mockResolvedValue({
      eligible: false,
      failures: [{ rule: "FEES", message: "Fees not cleared" }],
    });
    const req = makeReq({
      params: { examId: "exam-1" },
      body: {
        studentId: "stu-1",
        ruleConfig: { feesClearedTillMonth: "2026-06" },
        onIneligible: "PROVISIONAL",
        provisionalSubjectIds: ["sub-1", "sub-2"],
      },
    });
    const res = makeMockRes();

    await generateAdmitCard(req, res);

    expect(prisma.admitCard.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: "PROVISIONAL", allowedSubjectIds: ["sub-1", "sub-2"] }),
      })
    );
  });
});

describe("admitCard.controller - bulkGenerateAdmitCards", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.exam.findUnique as jest.Mock).mockResolvedValue(EXAM);
    (prisma.examSchedule.findMany as jest.Mock).mockResolvedValue([{ subjectId: "sub-1" }, { subjectId: "sub-2" }]);
    (prisma.admitCard.upsert as jest.Mock).mockImplementation(({ create }: any) => Promise.resolve({ id: "ac-x", ...create }));
  });

  it("returns 404 when the exam does not exist", async () => {
    (prisma.exam.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { examId: "exam-1" }, body: {} });
    const res = makeMockRes();

    await bulkGenerateAdmitCards(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns a zero-total summary when the class has no active students", async () => {
    (prisma.student.findMany as jest.Mock).mockResolvedValue([]);
    const req = makeReq({ params: { examId: "exam-1" }, body: {} });
    const res = makeMockRes();

    await bulkGenerateAdmitCards(req, res);

    const payload = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(payload.total).toBe(0);
  });

  it("generates one admit card per active student and tallies eligible/provisional/denied", async () => {
    (prisma.student.findMany as jest.Mock).mockResolvedValue([{ id: "stu-1" }, { id: "stu-2" }, { id: "stu-3" }]);
    (evaluateStudentEligibility as jest.Mock)
      .mockResolvedValueOnce({ eligible: true, failures: [] }) // stu-1
      .mockResolvedValueOnce({ eligible: false, failures: [{ rule: "ATTENDANCE", message: "low attendance" }] }) // stu-2
      .mockResolvedValueOnce({ eligible: false, failures: [{ rule: "FEES", message: "fees pending" }] }); // stu-3

    const req = makeReq({
      params: { examId: "exam-1" },
      body: { ruleConfig: { minAttendancePercent: 75 }, onIneligible: "PROVISIONAL" },
    });
    const res = makeMockRes();

    await bulkGenerateAdmitCards(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(payload.total).toBe(3);
    expect(payload.eligible).toBe(1);
    expect(payload.provisional).toBe(2);
    expect(payload.denied).toBe(0);
    expect(prisma.admitCard.upsert).toHaveBeenCalledTimes(3);
  });

  it("restricts PROVISIONAL students to every subject already scheduled for the exam", async () => {
    (prisma.student.findMany as jest.Mock).mockResolvedValue([{ id: "stu-1" }]);
    (evaluateStudentEligibility as jest.Mock).mockResolvedValue({ eligible: false, failures: [{ rule: "FEES", message: "fees pending" }] });

    const req = makeReq({
      params: { examId: "exam-1" },
      body: { ruleConfig: { feesClearedTillMonth: "2026-06" }, onIneligible: "PROVISIONAL" },
    });
    const res = makeMockRes();

    await bulkGenerateAdmitCards(req, res);

    expect(prisma.admitCard.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ allowedSubjectIds: ["sub-1", "sub-2"] }) })
    );
  });
});

describe("admitCard.controller - getAdmitCards", () => {
  it("returns 404 when the exam does not exist", async () => {
    (prisma.exam.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { examId: "exam-1" } });
    const res = makeMockRes();

    await getAdmitCards(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects an exam belonging to a DIFFERENT branch", async () => {
    (prisma.exam.findUnique as jest.Mock).mockResolvedValue({ class: { branchId: "branch-OTHER" } });
    const req = makeReq({ params: { examId: "exam-1" } });
    const res = makeMockRes();

    await getAdmitCards(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns the admit cards list on success", async () => {
    (prisma.exam.findUnique as jest.Mock).mockResolvedValue({ class: { branchId: "branch-1" } });
    (prisma.admitCard.findMany as jest.Mock).mockResolvedValue([{ id: "ac-1" }]);
    const req = makeReq({ params: { examId: "exam-1" } });
    const res = makeMockRes();

    await getAdmitCards(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe("admitCard.controller - deleteAdmitCard", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 404 when the admit card does not exist", async () => {
    (prisma.admitCard.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { examId: "exam-1", studentId: "stu-1" } });
    const res = makeMockRes();

    await deleteAdmitCard(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects an admit card whose student belongs to a DIFFERENT branch", async () => {
    (prisma.admitCard.findUnique as jest.Mock).mockResolvedValue({ id: "ac-1", student: { branchId: "branch-OTHER" } });
    const req = makeReq({ params: { examId: "exam-1", studentId: "stu-1" } });
    const res = makeMockRes();

    await deleteAdmitCard(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("deletes the admit card when found and accessible", async () => {
    (prisma.admitCard.findUnique as jest.Mock).mockResolvedValue({ id: "ac-1", pdfUrl: null, student: { branchId: "branch-1" } });
    const req = makeReq({ params: { examId: "exam-1", studentId: "stu-1" } });
    const res = makeMockRes();

    await deleteAdmitCard(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.admitCard.delete).toHaveBeenCalledWith({ where: { id: "ac-1" } });
  });
});

describe("admitCard.controller - getAdmitCardPdf", () => {
  const STUDENT = {
    id: "stu-1",
    admissionNo: "A1",
    user: { name: "Test Student" },
    class: { name: "Class 5" },
    section: { name: "A" },
    branch: { name: "ABC School" },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getActiveDocumentTemplate as jest.Mock).mockResolvedValue(null);
    (renderTemplateToPdf as jest.Mock).mockResolvedValue(null);
    (prisma.exam.findUnique as jest.Mock).mockResolvedValue(EXAM);
    (prisma.student.findUnique as jest.Mock).mockResolvedValue(STUDENT);
    (prisma.examSchedule.findMany as jest.Mock).mockResolvedValue([]);
  });

  it("returns 404 when no admit card has been generated yet", async () => {
    (prisma.admitCard.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { examId: "exam-1", studentId: "stu-1" } });
    const res = makeMockRes();

    await getAdmitCardPdf(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects downloading a DENIED admit card", async () => {
    (prisma.admitCard.findUnique as jest.Mock).mockResolvedValue({ status: "DENIED", remarks: "Attendance too low" });
    const req = makeReq({ params: { examId: "exam-1", studentId: "stu-1" } });
    const res = makeMockRes();

    await getAdmitCardPdf(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("streams the PDF for an ELIGIBLE admit card (no error response)", async () => {
    (prisma.admitCard.findUnique as jest.Mock).mockResolvedValue({ status: "ELIGIBLE", remarks: null, allowedSubjectIds: [], serialNo: "AC-1" });
    const req = makeReq({ params: { examId: "exam-1", studentId: "stu-1" } });
    const res = makeMockRes();

    await getAdmitCardPdf(req, res);

    expect(res.status).not.toHaveBeenCalledWith(404);
    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(res.status).not.toHaveBeenCalledWith(500);
  });

  it("filters the schedule to only allowedSubjectIds for a PROVISIONAL admit card", async () => {
    (prisma.admitCard.findUnique as jest.Mock).mockResolvedValue({
      status: "PROVISIONAL", remarks: "Fees pending", allowedSubjectIds: ["sub-1"], serialNo: "AC-1",
    });
    const req = makeReq({ params: { examId: "exam-1", studentId: "stu-1" } });
    const res = makeMockRes();

    await getAdmitCardPdf(req, res);

    expect((prisma.examSchedule.findMany as jest.Mock).mock.calls[0][0].where.subjectId).toEqual({ in: ["sub-1"] });
  });
});
