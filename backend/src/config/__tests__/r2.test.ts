const mockSend = jest.fn();
const mockUploadDone = jest.fn();

jest.mock("@aws-sdk/client-s3", () => {
  return {
    S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
    DeleteObjectCommand: jest.fn().mockImplementation((input) => ({ __type: "DeleteObjectCommand", input })),
    GetObjectCommand: jest.fn().mockImplementation((input) => ({ __type: "GetObjectCommand", input })),
  };
});

jest.mock("@aws-sdk/lib-storage", () => ({
  Upload: jest.fn().mockImplementation((opts) => ({
    __opts: opts,
    done: mockUploadDone,
  })),
}));

jest.mock("../index", () => ({
  config: {
    r2: {
      accountId: "test-account",
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
      bucketName: "test-bucket",
      publicUrl: "",
      endpoint: "",
      region: "auto",
    },
  },
}));

jest.mock("../logger", () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import { Upload } from "@aws-sdk/lib-storage";
import { DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import {
  isR2Configured,
  uploadToR2,
  deleteFromR2,
  readFromR2,
  __resetR2ClientForTests,
} from "../r2";
import { config } from "../index";

describe("r2 config (Cloudflare R2 client + reusable helpers)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetR2ClientForTests();
    (config as any).r2 = {
      accountId: "test-account",
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
      bucketName: "test-bucket",
      publicUrl: "",
      endpoint: "",
      region: "auto",
    };
  });

  describe("isR2Configured", () => {
    it("returns true when every required R2 var is set", () => {
      expect(isR2Configured()).toBe(true);
    });

    it("returns false when any required R2 var is missing", () => {
      (config as any).r2 = { ...config.r2, bucketName: "" };
      expect(isR2Configured()).toBe(false);
    });
  });

  describe("uploadToR2", () => {
    it("uploads via @aws-sdk/lib-storage's Upload and returns a public URL + key under the given subDir", async () => {
      mockUploadDone.mockResolvedValue({});

      const result = await uploadToR2(Buffer.from("file contents"), "photo.png", undefined, "students/s1");

      expect(Upload).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            Bucket: "test-bucket",
            Key: expect.stringMatching(/^students\/s1\/[0-9a-f-]+\.png$/),
            Body: Buffer.from("file contents"),
            ContentType: "image/png",
          }),
        })
      );
      expect(mockUploadDone).toHaveBeenCalledTimes(1);
      // No R2_PUBLIC_URL configured - falls back to the raw R2 endpoint URL.
      expect(result.url).toMatch(
        /^https:\/\/test-account\.r2\.cloudflarestorage\.com\/test-bucket\/students\/s1\/[0-9a-f-]+\.png$/
      );
      expect(result.key).toMatch(/^students\/s1\/[0-9a-f-]+\.png$/);
    });

    it("uses R2_PUBLIC_URL for the returned URL when configured", async () => {
      (config as any).r2 = { ...config.r2, publicUrl: "https://files.myschool.com" };
      mockUploadDone.mockResolvedValue({});

      const result = await uploadToR2(Buffer.from("x"), "doc.pdf", undefined, "misc");

      expect(result.url).toMatch(/^https:\/\/files\.myschool\.com\/misc\/[0-9a-f-]+\.pdf$/);
    });

    it("uses an explicit R2_ENDPOINT override instead of the derived accountId-based endpoint", async () => {
      (config as any).r2 = { ...config.r2, endpoint: "https://custom-r2-endpoint.example.com" };
      __resetR2ClientForTests();
      mockUploadDone.mockResolvedValue({});

      const result = await uploadToR2(Buffer.from("x"), "doc.pdf", undefined, "misc");

      expect(result.url).toMatch(/^https:\/\/custom-r2-endpoint\.example\.com\/test-bucket\/misc\/[0-9a-f-]+\.pdf$/);
    });

    it("uses an explicit mimeType over the guessed content type", async () => {
      mockUploadDone.mockResolvedValue({});
      await uploadToR2(Buffer.from("x"), "file.bin", "application/pdf", "misc");
      expect(Upload).toHaveBeenCalledWith(
        expect.objectContaining({ params: expect.objectContaining({ ContentType: "application/pdf" }) })
      );
    });

    it("guesses a generic content type for an unknown extension with no mimeType given", async () => {
      mockUploadDone.mockResolvedValue({});
      await uploadToR2(Buffer.from("x"), "file.xyz", undefined, "misc");
      expect(Upload).toHaveBeenCalledWith(
        expect.objectContaining({ params: expect.objectContaining({ ContentType: "application/octet-stream" }) })
      );
    });
  });

  describe("deleteFromR2", () => {
    it("deletes the object matching a full public URL's key", async () => {
      mockSend.mockResolvedValue({});
      await deleteFromR2("https://files.myschool.com/students/s1/abc123.png");
      // publicUrl wasn't set for this URL's own domain in config, so the
      // whole pathname (minus leading slash) is used as the key.
      expect(DeleteObjectCommand).toHaveBeenCalledWith({ Bucket: "test-bucket", Key: "students/s1/abc123.png" });
    });

    it("deletes the object matching a raw key directly", async () => {
      mockSend.mockResolvedValue({});
      await deleteFromR2("students/s1/abc123.png");
      expect(DeleteObjectCommand).toHaveBeenCalledWith({ Bucket: "test-bucket", Key: "students/s1/abc123.png" });
    });

    it("does not throw if the delete call fails (best-effort)", async () => {
      mockSend.mockRejectedValue(new Error("network error"));
      await expect(deleteFromR2("students/s1/abc123.png")).resolves.toBeUndefined();
    });

    it("does nothing (no send call) when R2 is not configured", async () => {
      (config as any).r2 = {
        accountId: "",
        accessKeyId: "",
        secretAccessKey: "",
        bucketName: "",
        publicUrl: "",
        endpoint: "",
        region: "auto",
      };
      await deleteFromR2("students/s1/abc123.png");
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe("readFromR2", () => {
    it("reads back the object's bytes for an existing key", async () => {
      const chunks = [Buffer.from("hello "), Buffer.from("world")];
      mockSend.mockResolvedValue({
        Body: {
          [Symbol.asyncIterator]: async function* () {
            for (const c of chunks) yield c;
          },
        },
      });

      const result = await readFromR2("templates/document/tpl.docx");

      expect(GetObjectCommand).toHaveBeenCalledWith({ Bucket: "test-bucket", Key: "templates/document/tpl.docx" });
      expect(result?.toString()).toBe("hello world");
    });

    it("returns null and does not throw if the object doesn't exist", async () => {
      mockSend.mockRejectedValue(new Error("NoSuchKey"));
      expect(await readFromR2("templates/document/missing.docx")).toBeNull();
    });
  });
});
