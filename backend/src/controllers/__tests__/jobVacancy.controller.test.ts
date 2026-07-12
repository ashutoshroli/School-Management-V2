import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    jobVacancy: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    jobApplication: { create: jest.fn(), findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  },
}));

import prisma from "../../config/database";
import {
  getPublicJobVacancies,
  applyToJobVacancy,
  createJobVacancy,
  getJobVacancies,
  updateJobVacancy,
  deleteJobVacancy,
  getJobApplications,
  updateJobApplicationStatus,
} from "../jobVacancy.controller";
import { AuthRequest } from "../../types";
import { Request } from "express";

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

const makePublicReq = (overrides: any = {}): Request => ({ body: {}, params: {}, query: {}, ...overrides } as any);

describe("jobVacancy.controller - getPublicJobVacancies", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.jobVacancy.findMany as jest.Mock).mockResolvedValue([]);
  });

  it("only queries active, not-yet-closed vacancies", async () => {
    const req = makePublicReq();
    const res = makeMockRes();

    await getPublicJobVacancies(req, res);

    const whereArg = (prisma.jobVacancy.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.isActive).toBe(true);
    expect(whereArg.OR).toEqual([{ closingDate: null }, { closingDate: { gte: expect.any(Date) } }]);
  });
});

describe("jobVacancy.controller - applyToJobVacancy", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 404 when the vacancy does not exist or is inactive", async () => {
    (prisma.jobVacancy.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makePublicReq({ params: { id: "job-1" }, body: { applicantName: "X", email: "x@test.com", phone: "123" } });
    const res = makeMockRes();

    await applyToJobVacancy(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.jobApplication.create).not.toHaveBeenCalled();
  });

  it("rejects an application after the closing date", async () => {
    (prisma.jobVacancy.findUnique as jest.Mock).mockResolvedValue({ id: "job-1", isActive: true, closingDate: new Date("2020-01-01") });
    const req = makePublicReq({ params: { id: "job-1" }, body: { applicantName: "X", email: "x@test.com", phone: "123" } });
    const res = makeMockRes();

    await applyToJobVacancy(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("creates the application when the vacancy is open", async () => {
    (prisma.jobVacancy.findUnique as jest.Mock).mockResolvedValue({ id: "job-1", isActive: true, closingDate: null });
    (prisma.jobApplication.create as jest.Mock).mockResolvedValue({ id: "app-1" });
    const req = makePublicReq({ params: { id: "job-1" }, body: { applicantName: "Ravi", email: "ravi@test.com", phone: "9999999999" } });
    const res = makeMockRes();

    await applyToJobVacancy(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(prisma.jobApplication.create).toHaveBeenCalledWith({
      data: { jobVacancyId: "job-1", applicantName: "Ravi", email: "ravi@test.com", phone: "9999999999", resumeUrl: undefined, coverNote: undefined },
    });
  });
});

describe("jobVacancy.controller - createJobVacancy", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 400 when branchId cannot be resolved", async () => {
    const req = makeReq({ user: undefined, body: { title: "Teacher" } });
    const res = makeMockRes();

    await createJobVacancy(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("creates the vacancy for the resolved branch", async () => {
    (prisma.jobVacancy.create as jest.Mock).mockResolvedValue({ id: "job-1" });
    const req = makeReq({ body: { title: "Maths Teacher", description: "Full-time" } });
    const res = makeMockRes();

    await createJobVacancy(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(prisma.jobVacancy.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ branchId: "branch-1", title: "Maths Teacher", postedBy: "admin-1" }) })
    );
  });
});

describe("jobVacancy.controller - getJobVacancies", () => {
  it("scopes to the caller's own branch", async () => {
    (prisma.jobVacancy.findMany as jest.Mock).mockResolvedValue([]);
    const req = makeReq();
    const res = makeMockRes();

    await getJobVacancies(req, res);

    expect((prisma.jobVacancy.findMany as jest.Mock).mock.calls[0][0].where).toEqual({ branchId: "branch-1" });
  });
});

describe("jobVacancy.controller - updateJobVacancy", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 404 when the vacancy does not exist", async () => {
    (prisma.jobVacancy.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { id: "job-1" } });
    const res = makeMockRes();

    await updateJobVacancy(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects a vacancy belonging to a DIFFERENT branch", async () => {
    (prisma.jobVacancy.findUnique as jest.Mock).mockResolvedValue({ id: "job-1", branchId: "branch-OTHER" });
    const req = makeReq({ params: { id: "job-1" } });
    const res = makeMockRes();

    await updateJobVacancy(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("updates the vacancy (e.g. toggling isActive to close applications)", async () => {
    (prisma.jobVacancy.findUnique as jest.Mock).mockResolvedValue({ id: "job-1", branchId: "branch-1" });
    (prisma.jobVacancy.update as jest.Mock).mockResolvedValue({ id: "job-1", isActive: false });
    const req = makeReq({ params: { id: "job-1" }, body: { isActive: false } });
    const res = makeMockRes();

    await updateJobVacancy(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe("jobVacancy.controller - deleteJobVacancy", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.jobVacancy.findUnique as jest.Mock).mockResolvedValue({ id: "job-1", branchId: "branch-1" });
  });

  it("blocks deletion when applications already exist", async () => {
    (prisma.jobApplication.count as jest.Mock).mockResolvedValue(3);
    const req = makeReq({ params: { id: "job-1" } });
    const res = makeMockRes();

    await deleteJobVacancy(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.jobVacancy.delete).not.toHaveBeenCalled();
  });

  it("deletes the vacancy when no applications exist yet", async () => {
    (prisma.jobApplication.count as jest.Mock).mockResolvedValue(0);
    const req = makeReq({ params: { id: "job-1" } });
    const res = makeMockRes();

    await deleteJobVacancy(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(prisma.jobVacancy.delete).toHaveBeenCalledWith({ where: { id: "job-1" } });
  });
});

describe("jobVacancy.controller - getJobApplications", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.jobVacancy.findUnique as jest.Mock).mockResolvedValue({ id: "job-1", branchId: "branch-1" });
    (prisma.jobApplication.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.jobApplication.count as jest.Mock).mockResolvedValue(0);
  });

  it("returns 404 when the vacancy does not exist", async () => {
    (prisma.jobVacancy.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { id: "job-1" } });
    const res = makeMockRes();

    await getJobApplications(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects a vacancy belonging to a DIFFERENT branch", async () => {
    (prisma.jobVacancy.findUnique as jest.Mock).mockResolvedValue({ id: "job-1", branchId: "branch-OTHER" });
    const req = makeReq({ params: { id: "job-1" } });
    const res = makeMockRes();

    await getJobApplications(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe("jobVacancy.controller - updateJobApplicationStatus", () => {
  it("returns 404 when the application does not exist", async () => {
    (prisma.jobApplication.findUnique as jest.Mock).mockResolvedValue(null);
    const req = makeReq({ params: { id: "app-1" }, body: { status: "SHORTLISTED" } });
    const res = makeMockRes();

    await updateJobApplicationStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("SECURITY: rejects an application whose vacancy belongs to a DIFFERENT branch", async () => {
    (prisma.jobApplication.findUnique as jest.Mock).mockResolvedValue({ id: "app-1", jobVacancy: { branchId: "branch-OTHER" } });
    const req = makeReq({ params: { id: "app-1" }, body: { status: "SHORTLISTED" } });
    const res = makeMockRes();

    await updateJobApplicationStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("updates the application status", async () => {
    (prisma.jobApplication.findUnique as jest.Mock).mockResolvedValue({ id: "app-1", jobVacancy: { branchId: "branch-1" } });
    (prisma.jobApplication.update as jest.Mock).mockResolvedValue({ id: "app-1", status: "SHORTLISTED" });
    const req = makeReq({ params: { id: "app-1" }, body: { status: "SHORTLISTED" } });
    const res = makeMockRes();

    await updateJobApplicationStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });
});
