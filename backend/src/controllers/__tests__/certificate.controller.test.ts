import { UserRole } from "@prisma/client";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    certificateTemplate: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn() },
    student: { findUnique: jest.fn() },
    generatedCertificate: { count: jest.fn(), create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock("../../services/storage.service", () => ({
  storage: { save: jest.fn(), deleteByUrl: jest.fn() },
}));

jest.mock("../../services/certificateGenerator.service", () => ({
  renderCertificateByType: jest.fn(),
}));

jest.mock("../../services/auditLog.service", () => ({
  logAuditFromRequest: jest.fn(),
}));

import prisma from "../../config/database";
import { storage } from "../../services/storage.service";
import { renderCertificateByType } from "../../services/certificateGenerator.service";
import { generateCertificate, getGeneratedCertificates, verifyCertificate } from "../certificate.controller";
import { AuthRequest } from "../../types";

/** Minimal Express Response mock capturing status()/json() calls. */
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

const TEMPLATE = { id: "tmpl-1", name: "Transfer Certificate", type: "TRANSFER_CERTIFICATE", isActive: true };

const makeStudent = (branchId: string) => ({
  id: "student-1",
  admissionNo: "MAIN-00001",
  dateOfBirth: new Date("2012-05-10"),
  admissionDate: new Date("2018-04-01"),
  leavingDate: null,
  leavingReason: null,
  category: "General",
  nationality: "Indian",
  user: { name: "Ravi Kumar" },
  class: { name: "Class 8" },
  section: { name: "A" },
  branch: { id: branchId, name: "ABC School", address: "123 St", city: "Delhi", state: "Delhi", pincode: "110001", phone: "123" },
  parents: [
    { parent: { relation: "FATHER", user: { name: "Suresh Kumar" } } },
    { parent: { relation: "MOTHER", user: { name: "Anita Kumar" } } },
  ],
});

describe("certificate.controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback: any) =>
      callback({ generatedCertificate: { count: jest.fn().mockResolvedValue(0) } })
    );
  });

  describe("generateCertificate - access control", () => {
    it("SECURITY: rejects generating a certificate for a student in a different branch", async () => {
      (prisma.certificateTemplate.findUnique as jest.Mock).mockResolvedValue(TEMPLATE);
      (prisma.student.findUnique as jest.Mock).mockResolvedValue(makeStudent("branch-OTHER"));

      const req = makeReq({ body: { templateId: "tmpl-1", studentId: "student-1" } });
      const res = makeMockRes();

      await generateCertificate(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: "Student not found" }));
      // Must never reach PDF generation/storage for a student outside the caller's branch.
      expect(renderCertificateByType).not.toHaveBeenCalled();
      expect(storage.save).not.toHaveBeenCalled();
    });

    it("allows generating a certificate for a student in the caller's own branch", async () => {
      (prisma.certificateTemplate.findUnique as jest.Mock).mockResolvedValue(TEMPLATE);
      (prisma.student.findUnique as jest.Mock).mockResolvedValue(makeStudent("branch-1"));
      (renderCertificateByType as jest.Mock).mockResolvedValue(Buffer.from("%PDF-fake"));
      (storage.save as jest.Mock).mockResolvedValue({ url: "/uploads/certificates/CERT-000001.pdf" });
      (prisma.generatedCertificate.create as jest.Mock).mockResolvedValue({
        id: "gc-1",
        serialNo: "CERT-000001",
        pdfUrl: "/uploads/certificates/CERT-000001.pdf",
      });

      const req = makeReq({ body: { templateId: "tmpl-1", studentId: "student-1" } });
      const res = makeMockRes();

      await generateCertificate(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(storage.save).toHaveBeenCalledWith(expect.any(Buffer), "CERT-000001.pdf", "certificates");
    });

    it("SUPER_ADMIN can generate a certificate for a student in any branch", async () => {
      (prisma.certificateTemplate.findUnique as jest.Mock).mockResolvedValue(TEMPLATE);
      (prisma.student.findUnique as jest.Mock).mockResolvedValue(makeStudent("branch-OTHER"));
      (renderCertificateByType as jest.Mock).mockResolvedValue(Buffer.from("%PDF-fake"));
      (storage.save as jest.Mock).mockResolvedValue({ url: "/uploads/certificates/CERT-000002.pdf" });
      (prisma.generatedCertificate.create as jest.Mock).mockResolvedValue({ id: "gc-2", serialNo: "CERT-000002" });

      const req = makeReq({
        body: { templateId: "tmpl-1", studentId: "student-1" },
        user: { userId: "super-1", email: "super@test.com", role: UserRole.SUPER_ADMIN },
      });
      const res = makeMockRes();

      await generateCertificate(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
    });

    it("returns 404 when the template does not exist", async () => {
      (prisma.certificateTemplate.findUnique as jest.Mock).mockResolvedValue(null);

      const req = makeReq({ body: { templateId: "missing", studentId: "student-1" } });
      const res = makeMockRes();

      await generateCertificate(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(prisma.student.findUnique).not.toHaveBeenCalled();
    });

    it("returns 404 when the template is inactive", async () => {
      (prisma.certificateTemplate.findUnique as jest.Mock).mockResolvedValue({ ...TEMPLATE, isActive: false });

      const req = makeReq({ body: { templateId: "tmpl-1", studentId: "student-1" } });
      const res = makeMockRes();

      await generateCertificate(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("returns 400 with a clear message when the certificate type has no PDF generator (e.g. CUSTOM)", async () => {
      (prisma.certificateTemplate.findUnique as jest.Mock).mockResolvedValue({ ...TEMPLATE, type: "CUSTOM" });
      (prisma.student.findUnique as jest.Mock).mockResolvedValue(makeStudent("branch-1"));
      (renderCertificateByType as jest.Mock).mockReturnValue(null);

      const req = makeReq({ body: { templateId: "tmpl-1", studentId: "student-1" } });
      const res = makeMockRes();

      await generateCertificate(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(storage.save).not.toHaveBeenCalled();
    });
  });

  describe("generateCertificate - CUSTOM certificate customFields", () => {
    it("passes customFields through to the renderer as extraFields for a CUSTOM template", async () => {
      (prisma.certificateTemplate.findUnique as jest.Mock).mockResolvedValue({ ...TEMPLATE, type: "CUSTOM", templateUrl: "/uploads/templates/custom.docx" });
      (prisma.student.findUnique as jest.Mock).mockResolvedValue(makeStudent("branch-1"));
      (renderCertificateByType as jest.Mock).mockResolvedValue(Buffer.from("%PDF-fake"));
      (storage.save as jest.Mock).mockResolvedValue({ url: "/uploads/certificates/CERT-000003.pdf" });
      (prisma.generatedCertificate.create as jest.Mock).mockResolvedValue({ id: "gc-3", serialNo: "CERT-000003" });

      const req = makeReq({
        body: { templateId: "tmpl-1", studentId: "student-1", customFields: { eventName: "Annual Sports Day" } },
      });
      const res = makeMockRes();

      await generateCertificate(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(renderCertificateByType).toHaveBeenCalledWith(
        "CUSTOM",
        expect.objectContaining({ extraFields: { eventName: "Annual Sports Day" } })
      );
    });

    it("still generates successfully with no customFields provided (optional field)", async () => {
      (prisma.certificateTemplate.findUnique as jest.Mock).mockResolvedValue(TEMPLATE);
      (prisma.student.findUnique as jest.Mock).mockResolvedValue(makeStudent("branch-1"));
      (renderCertificateByType as jest.Mock).mockResolvedValue(Buffer.from("%PDF-fake"));
      (storage.save as jest.Mock).mockResolvedValue({ url: "/uploads/certificates/CERT-000004.pdf" });
      (prisma.generatedCertificate.create as jest.Mock).mockResolvedValue({ id: "gc-4", serialNo: "CERT-000004" });

      const req = makeReq({ body: { templateId: "tmpl-1", studentId: "student-1" } });
      const res = makeMockRes();

      await generateCertificate(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(renderCertificateByType).toHaveBeenCalledWith("TRANSFER_CERTIFICATE", expect.objectContaining({ extraFields: undefined }));
    });
  });

  describe("getGeneratedCertificates - branch scoping", () => {
    it("SECURITY: scopes results to the caller's own branch for non-Super-Admin users", async () => {
      (prisma.generatedCertificate.findMany as jest.Mock).mockResolvedValue([]);

      const req = makeReq({ query: {} });
      const res = makeMockRes();

      await getGeneratedCertificates(req, res);

      expect(prisma.generatedCertificate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ student: { branchId: "branch-1" } }) })
      );
    });

    it("does not scope by branch for SUPER_ADMIN (can see all branches)", async () => {
      (prisma.generatedCertificate.findMany as jest.Mock).mockResolvedValue([]);

      const req = makeReq({
        query: {},
        user: { userId: "super-1", email: "super@test.com", role: UserRole.SUPER_ADMIN },
      });
      const res = makeMockRes();

      await getGeneratedCertificates(req, res);

      const call = (prisma.generatedCertificate.findMany as jest.Mock).mock.calls[0][0];
      expect(call.where.student).toBeUndefined();
    });
  });

  describe("verifyCertificate (public endpoint)", () => {
    it("returns valid:true with minimal info for an existing serial number", async () => {
      (prisma.generatedCertificate.findUnique as jest.Mock).mockResolvedValue({
        serialNo: "CERT-000001",
        createdAt: new Date("2025-01-15"),
        template: { name: "Transfer Certificate", type: "TRANSFER_CERTIFICATE" },
        student: { admissionNo: "MAIN-00001", user: { name: "Ravi Kumar" }, branch: { name: "ABC School" } },
      });

      const req = makeReq({ params: { serialNo: "CERT-000001" }, user: undefined });
      const res = makeMockRes();

      await verifyCertificate(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ valid: true, serialNo: "CERT-000001", studentName: "Ravi Kumar" }),
        })
      );
    });

    it("returns valid:false (not a 404) for a non-existent serial number", async () => {
      (prisma.generatedCertificate.findUnique as jest.Mock).mockResolvedValue(null);

      const req = makeReq({ params: { serialNo: "CERT-DOES-NOT-EXIST" }, user: undefined });
      const res = makeMockRes();

      await verifyCertificate(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: { valid: false } }));
    });
  });
});
