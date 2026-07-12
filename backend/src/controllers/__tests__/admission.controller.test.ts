import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    admissionInquiry: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  },
}));

import prisma from "../../config/database";
import { getAdmissionInquiryById, getAdmissionInquiries } from "../admission.controller";
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
    user: { userId: "admin-1", email: "admin@test.com", role: UserRole.BRANCH_ADMIN, branchId: "branch-1" },
    ...overrides,
  } as any);

// The only prior way to see one inquiry's full detail was the PDF
// export (getAdmissionInquiryPdf) - there was no way to fetch it as
// JSON data for an in-app detail view/modal.
describe("admission.controller - getAdmissionInquiryById", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 404 when the inquiry does not exist", async () => {
    (prisma.admissionInquiry.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { id: "inq-1" } });
    const res = makeMockRes();

    await getAdmissionInquiryById(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects an inquiry belonging to a DIFFERENT branch", async () => {
    (prisma.admissionInquiry.findUnique as jest.Mock).mockResolvedValue({ id: "inq-1", branchId: "branch-OTHER" });
    const req = makeReq({ params: { id: "inq-1" } });
    const res = makeMockRes();

    await getAdmissionInquiryById(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns the inquiry when it belongs to the caller's own branch", async () => {
    (prisma.admissionInquiry.findUnique as jest.Mock).mockResolvedValue({
      id: "inq-1",
      branchId: "branch-1",
      studentName: "Ravi Kumar",
      branch: { name: "Main Campus", city: "Delhi" },
    });
    const req = makeReq({ params: { id: "inq-1" } });
    const res = makeMockRes();

    await getAdmissionInquiryById(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// Backend UX Gap Phase 3: getAdmissionInquiries previously had no
// classAppliedFor filter or date range - only status.
describe("admission.controller - getAdmissionInquiries (classAppliedFor + date-range filters)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.admissionInquiry.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.admissionInquiry.count as jest.Mock).mockResolvedValue(0);
  });

  it("filters by classAppliedFor as a case-insensitive partial match (it's free text, not a real classId)", async () => {
    const req = makeReq({ query: { classAppliedFor: "class 5" } });
    const res = makeMockRes();

    await getAdmissionInquiries(req, res);

    const whereArg = (prisma.admissionInquiry.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.classAppliedFor).toEqual({ contains: "class 5", mode: "insensitive" });
  });

  it("filters by a fromDate/toDate range on createdAt", async () => {
    const req = makeReq({ query: { fromDate: "2025-01-01", toDate: "2025-01-31" } });
    const res = makeMockRes();

    await getAdmissionInquiries(req, res);

    const whereArg = (prisma.admissionInquiry.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.createdAt).toEqual({ gte: new Date("2025-01-01"), lte: new Date("2025-01-31") });
  });
});
