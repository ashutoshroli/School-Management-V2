import { generateQrCodeBuffer, drawQrCode, renderPdfToBuffer } from "../pdf.service";

describe("pdf.service - QR code helpers", () => {
  describe("generateQrCodeBuffer", () => {
    it("produces a valid PNG buffer for a normal URL/text payload", async () => {
      const buf = await generateQrCodeBuffer("https://example.com/verify-certificate/CERT-000001");
      expect(buf).not.toBeNull();
      // PNG magic bytes.
      expect(buf!.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    });

    it("returns null instead of throwing for a payload too large to encode", async () => {
      // QR codes (even at the largest version, error-correction M) top
      // out at a few KB of alphanumeric/byte data - this deliberately
      // exceeds that so generateQrCodeBuffer's try/catch is exercised.
      const hugePayload = "x".repeat(50_000);
      const buf = await generateQrCodeBuffer(hugePayload);
      expect(buf).toBeNull();
    });
  });

  describe("drawQrCode", () => {
    it("calls doc.image() with the generated QR buffer at the given position/size", async () => {
      const doc = { image: jest.fn(), fontSize: jest.fn().mockReturnThis(), fillColor: jest.fn().mockReturnThis(), text: jest.fn().mockReturnThis() };
      await drawQrCode(doc as any, "https://example.com/verify/ABC", 100, 200, 50, "Scan me");

      expect(doc.image).toHaveBeenCalledTimes(1);
      const [imageBuf, x, y, opts] = doc.image.mock.calls[0];
      expect(Buffer.isBuffer(imageBuf)).toBe(true);
      expect(x).toBe(100);
      expect(y).toBe(200);
      expect(opts).toEqual({ width: 50, height: 50 });
      expect(doc.text).toHaveBeenCalledWith("Scan me", expect.any(Number), expect.any(Number), expect.objectContaining({ align: "center" }));
    });

    it("draws nothing (no throw) when QR generation fails", async () => {
      const doc = { image: jest.fn(), fontSize: jest.fn().mockReturnThis(), fillColor: jest.fn().mockReturnThis(), text: jest.fn().mockReturnThis() };
      await drawQrCode(doc as any, "x".repeat(50_000), 0, 0);

      expect(doc.image).not.toHaveBeenCalled();
      expect(doc.text).not.toHaveBeenCalled();
    });

    it("skips the caption text call when no caption is given", async () => {
      const doc = { image: jest.fn(), fontSize: jest.fn().mockReturnThis(), fillColor: jest.fn().mockReturnThis(), text: jest.fn().mockReturnThis() };
      await drawQrCode(doc as any, "https://example.com/x", 0, 0, 40);

      expect(doc.image).toHaveBeenCalledTimes(1);
      expect(doc.text).not.toHaveBeenCalled();
    });
  });

  describe("renderPdfToBuffer", () => {
    // Regression test for the switch from a synchronous `build`
    // callback to an async one (needed so a QR code can be awaited
    // before doc.end() is called) - verifies doc.end() only fires
    // after an async build function actually resolves, not before.
    it("awaits an async build callback before ending the document", async () => {
      let buildResolved = false;

      const buffer = await renderPdfToBuffer(async (doc) => {
        doc.fontSize(12).text("hello");
        await new Promise((resolve) => setTimeout(resolve, 20));
        buildResolved = true;
      });

      expect(buildResolved).toBe(true);
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    });

    it("still works with a synchronous (non-async) build callback", async () => {
      const buffer = await renderPdfToBuffer((doc) => {
        doc.fontSize(12).text("hello sync");
      });
      expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    });
  });
});
