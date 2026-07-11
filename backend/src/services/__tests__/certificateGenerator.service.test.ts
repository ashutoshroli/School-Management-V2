import {
  renderTransferCertificate,
  renderBonafideCertificate,
  renderCharacterCertificate,
  renderCertificateByType,
  CertificateRenderParams,
} from "../certificateGenerator.service";

/**
 * These tests render real PDFs via PDFKit (no mocking of pdf.service.ts
 * or pdfkit itself) - unlike most of this codebase's tests, which mock
 * Prisma, there's no I/O to fake here: rendering is a synchronous,
 * in-memory operation. Verifying the output is a well-formed,
 * non-trivial PDF (correct magic bytes, reasonable size) catches
 * regressions like a thrown layout error or an empty buffer without
 * needing to snapshot exact byte content (which would be brittle across
 * pdfkit version bumps).
 */

const baseParams: CertificateRenderParams = {
  serialNo: "CERT-000001",
  issueDate: new Date("2025-01-15"),
  verifyUrl: "https://school.example.com/verify-certificate/CERT-000001",
  branch: {
    name: "ABC Public School",
    address: "123 Education Lane",
    city: "New Delhi",
    state: "Delhi",
    pincode: "110001",
    phone: "+91-11-23456789",
  },
  student: {
    admissionNo: "MAIN-00001",
    studentName: "Ravi Kumar",
    fatherName: "Suresh Kumar",
    motherName: "Anita Kumar",
    dateOfBirth: new Date("2012-05-10"),
    className: "Class 8",
    sectionName: "A",
    admissionDate: new Date("2018-04-01"),
    leavingDate: new Date("2025-01-10"),
    leavingReason: "Family relocation",
    category: "General",
    nationality: "Indian",
  },
};

/** A valid PDF's bytes always begin with this ASCII header. */
const PDF_MAGIC_BYTES = "%PDF-";

describe("certificateGenerator.service", () => {
  describe("renderTransferCertificate", () => {
    it("produces a well-formed, non-trivial PDF buffer", async () => {
      const buffer = await renderTransferCertificate(baseParams);

      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.subarray(0, 5).toString("ascii")).toBe(PDF_MAGIC_BYTES);
      // A single-page text certificate should comfortably exceed a
      // couple KB once fonts/structure are embedded - guards against a
      // silently-empty/near-empty render.
      expect(buffer.length).toBeGreaterThan(1000);
    });

    it("still renders successfully when optional student fields are missing", async () => {
      const params: CertificateRenderParams = {
        ...baseParams,
        student: {
          ...baseParams.student,
          leavingDate: null,
          leavingReason: null,
          category: null,
          nationality: null,
        },
      };

      const buffer = await renderTransferCertificate(params);
      expect(buffer.subarray(0, 5).toString("ascii")).toBe(PDF_MAGIC_BYTES);
    });
  });

  describe("renderBonafideCertificate", () => {
    it("produces a well-formed PDF buffer", async () => {
      const buffer = await renderBonafideCertificate({ ...baseParams, purpose: "applying for a passport" });
      expect(buffer.subarray(0, 5).toString("ascii")).toBe(PDF_MAGIC_BYTES);
    });

    it("renders successfully without an explicit purpose (falls back to generic wording)", async () => {
      const buffer = await renderBonafideCertificate(baseParams);
      expect(buffer.subarray(0, 5).toString("ascii")).toBe(PDF_MAGIC_BYTES);
    });
  });

  describe("renderCharacterCertificate", () => {
    it("produces a well-formed PDF buffer", async () => {
      const buffer = await renderCharacterCertificate(baseParams);
      expect(buffer.subarray(0, 5).toString("ascii")).toBe(PDF_MAGIC_BYTES);
    });
  });

  describe("renderCertificateByType", () => {
    it.each([
      ["TRANSFER_CERTIFICATE"],
      ["BONAFIDE"],
      ["CHARACTER"],
    ])("dispatches %s to a real renderer", async (type) => {
      const result = renderCertificateByType(type as any, baseParams);
      expect(result).not.toBeNull();
      const buffer = await result!;
      expect(buffer.subarray(0, 5).toString("ascii")).toBe(PDF_MAGIC_BYTES);
    });

    it("returns null for ID_CARD (has its own dedicated generator, not this dispatcher)", () => {
      expect(renderCertificateByType("ID_CARD" as any, baseParams)).toBeNull();
    });

    it("returns null for CUSTOM (no generic renderer implemented yet)", () => {
      expect(renderCertificateByType("CUSTOM" as any, baseParams)).toBeNull();
    });
  });
});
