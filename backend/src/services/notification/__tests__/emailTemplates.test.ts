import { feePaymentReceiptEmail, feeReminderEmail, welcomeEmail, genericNotificationEmail } from "../emailTemplates";

describe("emailTemplates", () => {
  describe("feePaymentReceiptEmail", () => {
    it("includes the amount, receipt number and student name in both html and text", () => {
      const result = feePaymentReceiptEmail({
        studentName: "John Doe",
        amount: 5000,
        receiptNo: "RCP-000123",
        paidAt: new Date("2025-01-15"),
      });

      expect(result.subject).toContain("RCP-000123");
      expect(result.html).toContain("John Doe");
      expect(result.html).toContain("5,000");
      expect(result.text).toContain("RCP-000123");
      expect(result.text).toContain("John Doe");
    });

    it("includes a download link when receiptDownloadUrl is provided", () => {
      const result = feePaymentReceiptEmail({
        studentName: "Jane",
        amount: 100,
        receiptNo: "RCP-1",
        paidAt: new Date(),
        receiptDownloadUrl: "https://school.com/receipts/1.pdf",
      });

      expect(result.html).toContain("https://school.com/receipts/1.pdf");
      expect(result.text).toContain("https://school.com/receipts/1.pdf");
    });

    it("omits the download link block when no URL is given", () => {
      const result = feePaymentReceiptEmail({
        studentName: "Jane",
        amount: 100,
        receiptNo: "RCP-1",
        paidAt: new Date(),
      });

      expect(result.html).not.toContain("Download Receipt");
    });
  });

  describe("feeReminderEmail", () => {
    it("renders parent name, student name and pending amount", () => {
      const result = feeReminderEmail({
        parentName: "Mr. Sharma",
        studentName: "Ravi Sharma",
        pendingAmount: 2500,
      });

      expect(result.html).toContain("Mr. Sharma");
      expect(result.html).toContain("Ravi Sharma");
      expect(result.html).toContain("2,500");
      expect(result.subject).toContain("Ravi Sharma");
    });

    it("includes the due date and pay-now link when provided", () => {
      const result = feeReminderEmail({
        parentName: "Mr. Sharma",
        studentName: "Ravi",
        pendingAmount: 100,
        dueDate: "the 10th of this month",
        payNowUrl: "https://school.com/pay",
      });

      expect(result.html).toContain("the 10th of this month");
      expect(result.html).toContain("https://school.com/pay");
    });
  });

  describe("welcomeEmail", () => {
    it("includes login email and login URL", () => {
      const result = welcomeEmail({
        name: "New Parent",
        email: "parent@test.com",
        loginUrl: "https://school.com/auth/login",
      });

      expect(result.html).toContain("parent@test.com");
      expect(result.html).toContain("https://school.com/auth/login");
      expect(result.html).not.toContain("Temporary Password");
    });

    it("includes a temporary password row when provided", () => {
      const result = welcomeEmail({
        name: "New Parent",
        email: "parent@test.com",
        temporaryPassword: "Temp@123",
        loginUrl: "https://school.com/auth/login",
      });

      expect(result.html).toContain("Temp@123");
    });
  });

  describe("genericNotificationEmail", () => {
    it("converts newlines in the body to <br/> in the html output", () => {
      const result = genericNotificationEmail({ title: "Notice", body: "Line one\nLine two" });

      expect(result.html).toContain("Line one<br/>Line two");
      expect(result.text).toBe("Line one\nLine two");
      expect(result.subject).toBe("Notice");
    });
  });
});
