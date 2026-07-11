jest.mock("../../config", () => ({
  config: {
    upload: { dir: "/tmp/school-erp-test-uploads", maxSize: 10485760 },
    s3: { provider: "local", bucket: "", region: "us-east-1", accessKeyId: "", secretAccessKey: "", endpoint: "", publicUrl: "" },
  },
}));

jest.mock("../../config/logger", () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

const mockS3StorageProviderCtor = jest.fn();
jest.mock("../storage/s3Provider", () => ({
  S3StorageProvider: mockS3StorageProviderCtor,
}));

import { config } from "../../config";
import { logger } from "../../config/logger";
import { getStorageProvider } from "../storage.service";

describe("getStorageProvider (Phase 6 factory)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (config as any).s3 = { provider: "local", bucket: "", region: "us-east-1", accessKeyId: "", secretAccessKey: "", endpoint: "", publicUrl: "" };
  });

  it("returns a local-disk provider when STORAGE_PROVIDER is unset/local", () => {
    const provider = getStorageProvider();
    expect(provider.constructor.name).toBe("LocalStorageProvider");
    expect(mockS3StorageProviderCtor).not.toHaveBeenCalled();
  });

  it("returns an S3 provider when STORAGE_PROVIDER=s3 and credentials are complete", () => {
    (config as any).s3 = {
      provider: "s3",
      bucket: "my-bucket",
      region: "us-east-1",
      accessKeyId: "key",
      secretAccessKey: "secret",
      endpoint: "",
      publicUrl: "",
    };

    getStorageProvider();

    expect(mockS3StorageProviderCtor).toHaveBeenCalledTimes(1);
  });

  it("falls back to local storage (and warns) when STORAGE_PROVIDER=s3 but credentials are incomplete", () => {
    (config as any).s3 = {
      provider: "s3",
      bucket: "",
      region: "us-east-1",
      accessKeyId: "",
      secretAccessKey: "",
      endpoint: "",
      publicUrl: "",
    };

    const provider = getStorageProvider();

    expect(provider.constructor.name).toBe("LocalStorageProvider");
    expect(mockS3StorageProviderCtor).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/falling back to local disk storage/i));
  });
});

describe("LocalStorageProvider", () => {
  const fs = require("fs");

  afterEach(() => {
    fs.rmSync("/tmp/school-erp-test-uploads", { recursive: true, force: true });
  });

  it("saves a buffer and returns a /uploads/ prefixed URL preserving the extension", async () => {
    const provider = getStorageProvider();
    const { url } = await provider.save(Buffer.from("hello"), "photo.png", "students/s1");

    expect(url).toMatch(/^\/uploads\/students\/s1\/[0-9a-f-]+\.png$/);
  });

  it("round-trips a saved file through readByUrl", async () => {
    const provider = getStorageProvider();
    const { url } = await provider.save(Buffer.from("round trip content"), "doc.pdf", "staff/s1");

    const readBack = await provider.readByUrl(url);
    expect(readBack?.toString()).toBe("round trip content");
  });

  it("deletes a saved file so it can no longer be read back", async () => {
    const provider = getStorageProvider();
    const { url } = await provider.save(Buffer.from("to be deleted"), "temp.txt", "misc");

    await provider.deleteByUrl(url);

    expect(await provider.readByUrl(url)).toBeNull();
  });

  it("returns null for readByUrl on a URL outside the uploads prefix", async () => {
    const provider = getStorageProvider();
    expect(await provider.readByUrl("/etc/passwd")).toBeNull();
  });
});
