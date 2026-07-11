import { CertificateType } from "@prisma/client";
import { renderPdfToBuffer, drawFooter, formatDate } from "./pdf.service";
import { renderTemplateToPdf, TemplateData } from "./templateRenderer.service";

/**
 * PDF generation for certificates. Two sources, tried in order:
 *
 *  1. The school's own uploaded .docx template (CertificateTemplate.
 *     templateUrl, managed on the Templates page) - filled in with the
 *     placeholders documented there ({{studentName}}, {{serialNo}},
 *     etc.) and converted to PDF via LibreOffice. This is how a school
 *     gets a certificate that matches their own letterhead/wording
 *     instead of the generic layout below.
 *  2. A hardcoded PDFKit layout (the three `render*Certificate`
 *     functions below) - used whenever (1) isn't available: no
 *     template uploaded yet, the template file is unreadable, or this
 *     host has no LibreOffice installed (see docxToPdf.service.ts).
 *     TRANSFER_CERTIFICATE/BONAFIDE/CHARACTER all have a PDFKit
 *     fallback; ID_CARD and CUSTOM do not (ID_CARD has its own
 *     structured generator in document.controller.ts, and CUSTOM has no
 *     generic hardcoded layout at all - see renderCertificateByType).
 *
 * Each render function returns a Buffer rather than streaming to an
 * HTTP response, because a generated certificate is persisted (see
 * certificate.controller.ts's use of `services/storage.service.ts`)
 * and re-downloaded later by staff, the student, or a public verifier -
 * none of whom are the original request that triggered generation.
 */

export interface CertificateStudentInfo {
  admissionNo: string;
  studentName: string;
  fatherName: string;
  motherName: string;
  dateOfBirth: Date;
  className: string;
  sectionName: string;
  admissionDate: Date;
  leavingDate?: Date | null;
  leavingReason?: string | null;
  category?: string | null;
  nationality?: string | null;
}

export interface CertificateBranchInfo {
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  phone?: string | null;
}

export interface CertificateRenderParams {
  serialNo: string;
  issueDate: Date;
  branch: CertificateBranchInfo;
  student: CertificateStudentInfo;
  /** Public URL a verifier can visit to confirm this certificate's authenticity. */
  verifyUrl: string;
  /** Free-text purpose, used by Bonafide (e.g. "applying for a passport"). */
  purpose?: string;
  /** The admin-uploaded .docx template for this CertificateTemplate row, if any. */
  templateUrl?: string | null;
}

const branchAddressLine = (branch: CertificateBranchInfo): string =>
  [branch.address, branch.city, branch.state, branch.pincode].filter(Boolean).join(", ");

/**
 * Maps CertificateRenderParams onto the flat placeholder keys documented
 * on the Templates page's "Placeholder Guide" for certificates
 * (studentName, admissionNo, fatherName, ... branchName, serialNo,
 * issueDate, verifyUrl, purpose). Keeping this mapping in one place
 * means the guide shown to admins and the data actually substituted at
 * generation time can never silently drift apart.
 */
const toTemplateData = (params: CertificateRenderParams): TemplateData => ({
  studentName: params.student.studentName,
  admissionNo: params.student.admissionNo,
  fatherName: params.student.fatherName,
  motherName: params.student.motherName,
  dateOfBirth: formatDate(params.student.dateOfBirth),
  className: params.student.className,
  sectionName: params.student.sectionName,
  nationality: params.student.nationality || "Indian",
  category: params.student.category || "-",
  admissionDate: formatDate(params.student.admissionDate),
  leavingDate: params.student.leavingDate ? formatDate(params.student.leavingDate) : "",
  leavingReason: params.student.leavingReason || "",
  branchName: params.branch.name,
  branchAddress: branchAddressLine(params.branch),
  branchPhone: params.branch.phone || "",
  serialNo: params.serialNo,
  issueDate: formatDate(params.issueDate),
  verifyUrl: params.verifyUrl,
  purpose: params.purpose || "",
});

/**
 * Shared letterhead + signature block used by all three certificate
 * types below, so a school's look-and-feel stays consistent across
 * every generated document.
 */
const drawLetterhead = (doc: any, branch: CertificateBranchInfo, title: string) => {
  doc.fontSize(20).fillColor("#1e293b").text(branch.name, { align: "center" });
  doc.fontSize(9).fillColor("#64748b").text(branchAddressLine(branch), { align: "center" });
  if (branch.phone) {
    doc.fontSize(9).fillColor("#64748b").text(`Phone: ${branch.phone}`, { align: "center" });
  }
  doc.moveDown(0.5);
  doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor("#1e293b").lineWidth(1.5).stroke();
  doc.moveDown(1);
  doc.fontSize(15).fillColor("#0f172a").text(title, { align: "center", underline: true });
  doc.moveDown(1.5);
};

const drawSignatureBlock = (doc: any) => {
  doc.moveDown(3);
  const y = doc.y;
  const rightX = doc.page.width - doc.page.margins.right - 160;
  doc.moveTo(rightX, y).lineTo(rightX + 160, y).strokeColor("#94a3b8").stroke();
  doc.fontSize(9).fillColor("#475569").text("Principal / Head of Institution", rightX, y + 4, { width: 160, align: "center" });
};

const drawVerificationFooter = (doc: any, serialNo: string, issueDate: Date, verifyUrl: string) => {
  drawFooter(
    doc,
    `Serial No: ${serialNo}  |  Issued: ${formatDate(issueDate)}  |  Verify at: ${verifyUrl}`
  );
};

export const renderTransferCertificate = (params: CertificateRenderParams): Promise<Buffer> => {
  const { branch, student, serialNo, issueDate, verifyUrl } = params;

  return renderPdfToBuffer((doc) => {
    drawLetterhead(doc, branch, "TRANSFER CERTIFICATE");

    const leftX = doc.page.margins.left;
    const lineHeight = 22;
    let y = doc.y;

    const row = (label: string, value: string) => {
      doc.fontSize(10).fillColor("#475569").text(label, leftX, y, { width: 180 });
      doc.fontSize(10).fillColor("#0f172a").text(value || "-", leftX + 180, y, { width: doc.page.width - leftX - 180 - doc.page.margins.right });
      y += lineHeight;
    };

    row("Serial No.", serialNo);
    row("Admission No.", student.admissionNo);
    row("Student's Name", student.studentName);
    row("Father's Name", student.fatherName);
    row("Mother's Name", student.motherName);
    row("Date of Birth", formatDate(student.dateOfBirth));
    row("Nationality", student.nationality || "Indian");
    row("Category", student.category || "-");
    row("Class & Section (at time of leaving)", `${student.className} - ${student.sectionName}`);
    row("Date of Admission", formatDate(student.admissionDate));
    row("Date of Leaving", student.leavingDate ? formatDate(student.leavingDate) : formatDate(issueDate));
    row("Reason for Leaving", student.leavingReason || "Not specified");

    doc.y = y + 20;
    doc.fontSize(10).fillColor("#0f172a").text(
      `This is to certify that the above particulars are true as per the records of ${branch.name}. This certificate is issued on the request of the parent/guardian for the purpose of transfer.`,
      leftX,
      doc.y,
      { width: doc.page.width - leftX - doc.page.margins.right, align: "justify" }
    );

    drawSignatureBlock(doc);
    drawVerificationFooter(doc, serialNo, issueDate, verifyUrl);
  });
};

export const renderBonafideCertificate = (params: CertificateRenderParams): Promise<Buffer> => {
  const { branch, student, serialNo, issueDate, verifyUrl, purpose } = params;

  return renderPdfToBuffer((doc) => {
    drawLetterhead(doc, branch, "BONAFIDE CERTIFICATE");

    const leftX = doc.page.margins.left;
    const width = doc.page.width - leftX - doc.page.margins.right;

    doc.fontSize(11).fillColor("#0f172a").text(
      `This is to certify that ${student.studentName}, son/daughter of ${student.fatherName}, ` +
        `bearing Admission No. ${student.admissionNo}, is a bonafide student of ${branch.name}, ` +
        `currently studying in Class ${student.className} - ${student.sectionName} for the academic session.`,
      leftX,
      doc.y,
      { width, align: "justify" }
    );
    doc.moveDown(1);

    doc.fontSize(11).fillColor("#0f172a").text(
      `Date of Birth as per school records: ${formatDate(student.dateOfBirth)}.`,
      leftX,
      doc.y,
      { width }
    );
    doc.moveDown(1);

    doc.fontSize(11).fillColor("#0f172a").text(
      `This certificate is issued on the request of the parent/guardian for the purpose of ${purpose || "official use"}.`,
      leftX,
      doc.y,
      { width, align: "justify" }
    );

    drawSignatureBlock(doc);
    drawVerificationFooter(doc, serialNo, issueDate, verifyUrl);
  });
};

export const renderCharacterCertificate = (params: CertificateRenderParams): Promise<Buffer> => {
  const { branch, student, serialNo, issueDate, verifyUrl } = params;

  return renderPdfToBuffer((doc) => {
    drawLetterhead(doc, branch, "CHARACTER CERTIFICATE");

    const leftX = doc.page.margins.left;
    const width = doc.page.width - leftX - doc.page.margins.right;

    doc.fontSize(11).fillColor("#0f172a").text(
      `This is to certify that ${student.studentName}, son/daughter of ${student.fatherName}, ` +
        `Admission No. ${student.admissionNo}, was/is a student of ${branch.name} in Class ` +
        `${student.className} - ${student.sectionName}.`,
      leftX,
      doc.y,
      { width, align: "justify" }
    );
    doc.moveDown(1);

    doc.fontSize(11).fillColor("#0f172a").text(
      "During the period of study at this institution, his/her conduct and character have been found to be satisfactory. " +
        "No disciplinary action has been recorded against the student as per available school records.",
      leftX,
      doc.y,
      { width, align: "justify" }
    );
    doc.moveDown(1);

    doc.fontSize(11).fillColor("#0f172a").text(
      "This certificate is issued on the request of the student/parent for the purpose of future reference.",
      leftX,
      doc.y,
      { width, align: "justify" }
    );

    drawSignatureBlock(doc);
    drawVerificationFooter(doc, serialNo, issueDate, verifyUrl);
  });
};

/**
 * Dispatches to the correct renderer for a given CertificateType,
 * always trying the school's own uploaded .docx template first (see
 * file header comment). ID_CARD is NOT handled here - it has its own
 * structured (non-prose) generator in document.controller.ts. CUSTOM
 * has no hardcoded PDFKit fallback (there's no generic "narrative"
 * layout that makes sense for an arbitrary certificate type), so for
 * CUSTOM the uploaded template is the *only* way to generate a PDF -
 * this returns null for CUSTOM if no template is uploaded/usable yet,
 * same as it always has.
 */
export const renderCertificateByType = async (
  type: CertificateType,
  params: CertificateRenderParams
): Promise<Buffer | null> => {
  const fromTemplate = await renderTemplateToPdf(params.templateUrl, toTemplateData(params));
  if (fromTemplate) return fromTemplate;

  switch (type) {
    case "TRANSFER_CERTIFICATE":
      return renderTransferCertificate(params);
    case "BONAFIDE":
      return renderBonafideCertificate(params);
    case "CHARACTER":
      return renderCharacterCertificate(params);
    default:
      return null;
  }
};
