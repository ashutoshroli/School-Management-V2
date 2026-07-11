import { buildCsv, sendCsv, CsvColumn } from "../csvExport.service";

interface TestRow {
  name: string;
  amount: number;
  notes?: string | null;
}

const COLUMNS: CsvColumn<TestRow>[] = [
  { header: "Name", accessor: (r) => r.name },
  { header: "Amount", accessor: (r) => r.amount },
  { header: "Notes", accessor: (r) => r.notes },
];

describe("csvExport.service", () => {
  describe("buildCsv", () => {
    it("builds a header row followed by one data row per input row", () => {
      const rows: TestRow[] = [{ name: "Ravi Kumar", amount: 500, notes: null }];
      const csv = buildCsv(rows, COLUMNS);
      const lines = csv.split("\r\n");

      expect(lines[0]).toBe("Name,Amount,Notes");
      expect(lines[1]).toBe("Ravi Kumar,500,");
      expect(lines.length).toBe(2);
    });

    it("produces zero data rows (just the header) for an empty input array", () => {
      const csv = buildCsv([], COLUMNS);
      expect(csv).toBe("Name,Amount,Notes");
    });

    it("SECURITY/CORRECTNESS: quotes and escapes a field containing a comma", () => {
      const rows: TestRow[] = [{ name: "Kumar, Ravi", amount: 100 }];
      const csv = buildCsv(rows, COLUMNS);
      expect(csv).toContain('"Kumar, Ravi",100');
    });

    it("escapes embedded double-quotes by doubling them, per RFC 4180", () => {
      const rows: TestRow[] = [{ name: 'Ravi "The Great" Kumar', amount: 100 }];
      const csv = buildCsv(rows, COLUMNS);
      expect(csv).toContain('"Ravi ""The Great"" Kumar"');
    });

    it("quotes a field containing an embedded newline", () => {
      const rows: TestRow[] = [{ name: "Line1\nLine2", amount: 100 }];
      const csv = buildCsv(rows, COLUMNS);
      expect(csv).toContain('"Line1\nLine2"');
    });

    it("does not quote plain alphanumeric fields (keeps output minimal/readable)", () => {
      const rows: TestRow[] = [{ name: "Ravi Kumar", amount: 500 }];
      const csv = buildCsv(rows, COLUMNS);
      expect(csv).not.toContain('"Ravi Kumar"');
    });

    it("renders null/undefined accessor values as an empty field, not the literal string 'null'", () => {
      const rows: TestRow[] = [{ name: "Ravi", amount: 100, notes: undefined }];
      const csv = buildCsv(rows, COLUMNS);
      const dataLine = csv.split("\r\n")[1];
      expect(dataLine).toBe("Ravi,100,");
      expect(dataLine).not.toContain("null");
      expect(dataLine).not.toContain("undefined");
    });
  });

  describe("sendCsv", () => {
    it("sets the correct content-type and content-disposition headers", () => {
      const res: any = { setHeader: jest.fn(), send: jest.fn() };

      sendCsv(res, "report.csv", "Name,Amount\r\nRavi,100");

      expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/csv; charset=utf-8");
      expect(res.setHeader).toHaveBeenCalledWith("Content-Disposition", 'attachment; filename="report.csv"');
    });

    it("prepends a UTF-8 BOM to the response body so Excel renders it correctly", () => {
      const res: any = { setHeader: jest.fn(), send: jest.fn() };

      sendCsv(res, "report.csv", "Name,Amount\r\nRavi,100");

      expect(res.send).toHaveBeenCalledWith("\uFEFFName,Amount\r\nRavi,100");
    });
  });
});
