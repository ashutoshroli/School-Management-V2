import {
  renderTransferCertificate,
  renderBonafideCertificate,
  renderCharacterCertificate,
  renderCertificateByType,
  toTemplateData,
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

  describe("QR code verification", () => {
    // Every certificate now embeds a scannable QR code (linking to
    // verifyUrl) alongside the existing text footer - a real PDF image
    // XObject, not just a URL printed as text. Checked across all
    // three renderers since drawVerificationFooter/drawQrCode is shared
    // by all of them.
    it.each([
      ["renderTransferCertificate", renderTransferCertificate],
      ["renderBonafideCertificate", renderBonafideCertificate],
      ["renderCharacterCertificate", renderCharacterCertificate],
    ])("%s embeds a real QR code image in the PDF", async (_name, renderFn) => {
      const buffer = await (renderFn as (p: CertificateRenderParams) => Promise<Buffer>)(baseParams);
      const text = buffer.toString("latin1");
      expect(text).toContain("/Image");
      expect(text).toContain("/Width");
      expect(text).toContain("/Height");
    });
  });

  describe("renderCertificateByType", () => {
    // None of these params include a templateUrl, so
    // renderTemplateToPdf() short-circuits to null immediately and every
    // case below falls straight through to the PDFKit renderers (or the
    // "no fallback" null cases), exactly like before templates existed.
    it.each([
      ["TRANSFER_CERTIFICATE"],
      ["BONAFIDE"],
      ["CHARACTER"],
    ])("dispatches %s to a real renderer", async (type) => {
      const buffer = await renderCertificateByType(type as any, baseParams);
      expect(buffer).not.toBeNull();
      expect(buffer!.subarray(0, 5).toString("ascii")).toBe(PDF_MAGIC_BYTES);
    });

    it("returns null for ID_CARD (has its own dedicated generator, not this dispatcher)", async () => {
      expect(await renderCertificateByType("ID_CARD" as any, baseParams)).toBeNull();
    });

    it("returns null for CUSTOM when no template is uploaded (no generic PDFKit fallback exists)", async () => {
      expect(await renderCertificateByType("CUSTOM" as any, baseParams)).toBeNull();
    });
  });

  // extraFields feeds a CUSTOM certificate's admin-supplied placeholder
  // values (see CertificateRenderParams.extraFields's doc comment) -
  // these params have no templateUrl, so renderTemplateToPdf()
  // short-circuits to null regardless, but toTemplateData (exercised
  // indirectly via renderTemplateToPdf's data argument) must never
  // throw when extraFields is present, and standard fields must always
  // win over a colliding extraFields key.
  describe("extraFields (CUSTOM certificate custom field values)", () => {
    it("does not affect PDFKit rendering when set alongside a supported type", async () => {
      const buffer = await renderCertificateByType("TRANSFER_CERTIFICATE" as any, {
        ...baseParams,
        extraFields: { eventName: "Annual Sports Day" },
      });
      expect(buffer).not.toBeNull();
      expect(buffer!.subarray(0, 5).toString("ascii")).toBe(PDF_MAGIC_BYTES);
    });

    it("still returns null for CUSTOM with no template even when extraFields is provided", async () => {
      const buffer = await renderCertificateByType("CUSTOM" as any, {
        ...baseParams,
        extraFields: { eventName: "Annual Sports Day" },
      });
      expect(buffer).toBeNull();
    });

    it("merges extraFields alongside the standard placeholder data", () => {
      const data = toTemplateData({ ...baseParams, extraFields: { eventName: "Annual Sports Day", awardTitle: "Best Student" } });
      expect(data.eventName).toBe("Annual Sports Day");
      expect(data.awardTitle).toBe("Best Student");
      expect(data.studentName).toBe("Ravi Kumar");
    });

    it("DATA INTEGRITY: a standard field always wins over a colliding extraFields key", () => {
      const data = toTemplateData({
        ...baseParams,
        purpose: "applying for a passport",
        extraFields: { studentName: "SHOULD NOT WIN", purpose: "SHOULD NOT WIN" },
      });
      expect(data.studentName).toBe("Ravi Kumar");
      expect(data.purpose).toBe("applying for a passport");
    });
  });
});
