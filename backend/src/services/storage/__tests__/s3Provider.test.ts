const mockSend = jest.fn();

jest.mock("@aws-sdk/client-s3", () => {
  return {
    S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
    PutObjectCommand: jest.fn().mockImplementation((input) => ({ __type: "PutObjectCommand", input })),
    DeleteObjectCommand: jest.fn().mockImplementation((input) => ({ __type: "DeleteObjectCommand", input })),
    GetObjectCommand: jest.fn().mockImplementation((input) => ({ __type: "GetObjectCommand", input })),
  };
});

jest.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: jest.fn().mockResolvedValue("https://signed.example.com/file.pdf?sig=abc"),
}));

jest.mock("../../../config", () => ({
  config: {
    s3: {
      bucket: "test-bucket",
      region: "us-east-1",
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
      endpoint: "",
      publicUrl: "",
    },
  },
}));

jest.mock("../../../config/logger", () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import { S3StorageProvider } from "../s3Provider";
import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

describe("S3StorageProvider", () => {
  let provider: S3StorageProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new S3StorageProvider();
  });

  describe("save", () => {
    it("uploads the buffer under subDir with a random filename and returns a public URL", async () => {
      mockSend.mockResolvedValue({});

      const result = await provider.save(Buffer.from("file contents"), "photo.png", "students/s1");

      expect(PutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: "test-bucket",
          Key: expect.stringMatching(/^students\/s1\/[0-9a-f-]+\.png$/),
          Body: Buffer.from("file contents"),
          ContentType: "image/png",
        })
      );
      expect(result.url).toMatch(/^https:\/\/test-bucket\.s3\.us-east-1\.amazonaws\.com\/students\/s1\/[0-9a-f-]+\.png$/);
    });

    it("guesses a generic content type for an unknown extension", async () => {
      mockSend.mockResolvedValue({});
      await provider.save(Buffer.from("x"), "file.xyz", "misc");
      expect(PutObjectCommand).toHaveBeenCalledWith(expect.objectContaining({ ContentType: "application/octet-stream" }));
    });
  });

  describe("deleteByUrl", () => {
    it("deletes the object matching the URL's key", async () => {
      mockSend.mockResolvedValue({});
      const url = "https://test-bucket.s3.us-east-1.amazonaws.com/students/s1/abc123.png";

      await provider.deleteByUrl(url);

      expect(DeleteObjectCommand).toHaveBeenCalledWith({ Bucket: "test-bucket", Key: "students/s1/abc123.png" });
    });

    it("does not throw if the delete call fails (best-effort)", async () => {
      mockSend.mockRejectedValue(new Error("network error"));
      const url = "https://test-bucket.s3.us-east-1.amazonaws.com/students/s1/abc123.png";
      await expect(provider.deleteByUrl(url)).resolves.toBeUndefined();
    });

    it("does nothing for an unparseable URL", async () => {
      await provider.deleteByUrl("not a url");
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe("readByUrl", () => {
    it("returns null and does not throw if the object doesn't exist", async () => {
      mockSend.mockRejectedValue(new Error("NoSuchKey"));
      const url = "https://test-bucket.s3.us-east-1.amazonaws.com/students/s1/missing.png";
      expect(await provider.readByUrl(url)).toBeNull();
    });

    it("reads back the object's bytes for an existing key", async () => {
      const chunks = [Buffer.from("hello "), Buffer.from("world")];
      mockSend.mockResolvedValue({
        Body: {
          [Symbol.asyncIterator]: async function* () {
            for (const c of chunks) yield c;
          },
        },
      });

      const url = "https://test-bucket.s3.us-east-1.amazonaws.com/students/s1/doc.pdf";
      const result = await provider.readByUrl(url);

      expect(GetObjectCommand).toHaveBeenCalledWith({ Bucket: "test-bucket", Key: "students/s1/doc.pdf" });
      expect(result?.toString()).toBe("hello world");
    });
  });

  describe("getSignedDownloadUrl", () => {
    it("returns a signed URL for a valid object URL", async () => {
      const url = "https://test-bucket.s3.us-east-1.amazonaws.com/students/s1/private.pdf";
      const signed = await provider.getSignedDownloadUrl(url);
      expect(signed).toBe("https://signed.example.com/file.pdf?sig=abc");
    });

    it("returns null for an unparseable URL", async () => {
      expect(await provider.getSignedDownloadUrl("not a url")).toBeNull();
    });
  });
});
