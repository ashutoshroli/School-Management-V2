import PizZip from "pizzip";
import { fillDocxTemplate } from "../templateRenderer.service";

/**
 * Builds a minimal, valid .docx buffer whose word/document.xml body is
 * exactly `bodyXml` - just enough OOXML scaffolding for docxtemplater
 * to parse and render it, matching the structure of the real sample
 * templates checked into frontend/public/sample-templates/.
 */
const buildDocx = (bodyXml: string): Buffer => {
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${bodyXml}
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>
</w:body>
</w:document>`
  );
  return zip.generate({ type: "nodebuffer" }) as Buffer;
};

/** Extracts word/document.xml's text back out of a rendered .docx buffer, for assertions. */
const extractDocumentXml = (docxBuffer: Buffer): string => {
  const zip = new PizZip(docxBuffer);
  return zip.file("word/document.xml")!.asText();
};

describe("templateRenderer.service - fillDocxTemplate", () => {
  it("fills correctly-authored {{tag}} placeholders (the documented syntax)", () => {
    const docx = buildDocx(`<w:p><w:r><w:t>Student: {{studentName}}</w:t></w:r></w:p>`);
    const filled = fillDocxTemplate(docx, { studentName: "Saanvi Chatterjee" });
    expect(extractDocumentXml(filled)).toContain("Student: Saanvi Chatterjee");
  });

  it("REGRESSION: auto-upgrades a custom template's single-brace flat tags to the required double-brace syntax", () => {
    // Exactly the reported bug: a school authored their own Admit Card
    // template using docxtemplater's own DEFAULT single-brace syntax
    // (understandable - that's what docxtemplater's public docs show),
    // not knowing this app's renderer requires double braces.
    const docx = buildDocx(`<w:p><w:r><w:t>Student Name: {studentName}</w:t></w:r></w:p>`);
    const filled = fillDocxTemplate(docx, { studentName: "Saanvi Chatterjee" });
    expect(extractDocumentXml(filled)).toContain("Student Name: Saanvi Chatterjee");
    expect(extractDocumentXml(filled)).not.toContain("{studentName}");
  });

  it("REGRESSION: auto-upgrades a custom template's single-brace LOOP tags ({#arr}...{/arr}) to double-brace", () => {
    // Matches the real screenshot: {{studentName}} etc. rendered fine
    // (already double-brace), but the subjects TABLE used single-brace
    // {#subjects}/{subjectName}/{examDate}/{startTime}/{endTime}/
    // {roomNo}/{/subjects} and came out as that literal text.
    const docx = buildDocx(
      `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>{#subjects}{subjectName}</w:t></w:r></w:p></w:tc>` +
        `<w:tc><w:p><w:r><w:t>{examDate}</w:t></w:r></w:p></w:tc>` +
        `<w:tc><w:p><w:r><w:t>{startTime} - {endTime}</w:t></w:r></w:p></w:tc>` +
        `<w:tc><w:p><w:r><w:t>{roomNo}{/subjects}</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`
    );
    const filled = fillDocxTemplate(docx, {
      studentName: "Saanvi Chatterjee",
      subjects: [
        { subjectName: "Maths", examDate: "14 Jul 2026", startTime: "10:00", endTime: "10:30", roomNo: "03" },
        { subjectName: "Drawing", examDate: "14 Jul 2026", startTime: "10:35", endTime: "11:05", roomNo: "03" },
      ],
    });
    const xml = extractDocumentXml(filled);
    expect(xml).toContain("Maths");
    expect(xml).toContain("Drawing");
    expect(xml).not.toContain("{#subjects}");
    expect(xml).not.toContain("{/subjects}");
    expect(xml).not.toContain("{subjectName}");
  });

  it("does NOT touch single-brace text that happens not to match any real data key", () => {
    // A school's own unrelated single-brace note (e.g. a currency
    // shorthand) must never be mistaken for a placeholder just because
    // it LOOKS like one - only tag names matching a real key in this
    // render call's own data are upgraded.
    const docx = buildDocx(`<w:p><w:r><w:t>Approx fee: {approx} for {studentName}</w:t></w:r></w:p>`);
    const filled = fillDocxTemplate(docx, { studentName: "Saanvi Chatterjee" });
    const xml = extractDocumentXml(filled);
    expect(xml).toContain("Approx fee: {approx} for Saanvi Chatterjee");
  });

  it("leaves an already-correct {{#loop}}...{{/loop}} template completely untouched", () => {
    const docx = buildDocx(
      `<w:p><w:r><w:t>{{#subjects}}{{subjectName}}{{/subjects}}</w:t></w:r></w:p>`
    );
    const filled = fillDocxTemplate(docx, {
      subjects: [{ subjectName: "Maths" }, { subjectName: "Drawing" }],
    });
    const xml = extractDocumentXml(filled);
    expect(xml).toContain("Maths");
    expect(xml).toContain("Drawing");
  });

  it("upgrading a loop-body tag used OUTSIDE its loop still renders gracefully (empty) instead of crashing", () => {
    // {subjectName} is collected into flatKeys because it's ALSO a
    // valid tag name inside the `subjects` array's items (needed so
    // the loop-body regression test above upgrades it correctly
    // WITHIN {{#subjects}}...{{/subjects}}). Used here with no loop
    // wrapper at all, matching the real ADMIT_CARD data shape (which
    // has no top-level `subjectName`, unlike REPORT_CARD's "simple
    // template" fields) - it's still upgraded to {{subjectName}}, but
    // docxtemplater's nullGetter (configured in fillDocxTemplate)
    // resolves it to an empty string rather than throwing, since
    // there's no top-level match outside a loop scope.
    const docx = buildDocx(`<w:p><w:r><w:t>Outside any loop: [{subjectName}]</w:t></w:r></w:p>`);
    const filled = fillDocxTemplate(docx, {
      subjects: [{ subjectName: "Maths" }],
    });
    expect(extractDocumentXml(filled)).toContain("Outside any loop: []");
  });
});
