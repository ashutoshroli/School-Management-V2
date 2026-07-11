import https from "https";
import { EventEmitter } from "events";
import { postJson, postForm, getJson, HttpError } from "../httpClient";

jest.mock("https");

/**
 * Builds a fake `https.request` implementation that immediately responds
 * with the given status code and JSON-serializable body, without any
 * real network I/O - these tests exercise httpClient's request/response
 * plumbing (headers, JSON parsing, non-2xx -> HttpError) in isolation.
 */
function mockHttpsResponse(statusCode: number, responseBody: any) {
  (https.request as jest.Mock).mockImplementation((_opts: any, callback: any) => {
    const res = new EventEmitter() as any;
    res.statusCode = statusCode;
    const req = new EventEmitter() as any;
    req.write = jest.fn();
    req.end = jest.fn(() => {
      callback(res);
      const raw = typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody);
      res.emit("data", Buffer.from(raw));
      res.emit("end");
    });
    req.destroy = jest.fn();
    return req;
  });
}

describe("httpClient", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("postJson", () => {
    it("resolves with parsed JSON on a 2xx response", async () => {
      mockHttpsResponse(200, { success: true, id: "abc" });

      const result = await postJson("https://example.com/api/send", { to: "123" });

      expect(result).toEqual({ success: true, id: "abc" });
    });

    it("sends the body as JSON with correct headers", async () => {
      mockHttpsResponse(200, {});

      await postJson("https://example.com/api/send", { hello: "world" }, { headers: { "X-Api-Key": "k" } });

      const [opts] = (https.request as jest.Mock).mock.calls[0];
      expect(opts.method).toBe("POST");
      expect(opts.headers["Content-Type"]).toBe("application/json");
      expect(opts.headers["X-Api-Key"]).toBe("k");
    });

    it("throws HttpError with status/body on a non-2xx response", async () => {
      mockHttpsResponse(403, { error: "Forbidden" });

      await expect(postJson("https://example.com/api/send", {})).rejects.toMatchObject({
        statusCode: 403,
        body: { error: "Forbidden" },
      });
    });

    it("wraps the rejection as an instance of HttpError", async () => {
      mockHttpsResponse(500, "Internal Server Error");
      await expect(postJson("https://example.com/api/send", {})).rejects.toBeInstanceOf(HttpError);
    });
  });

  describe("postForm", () => {
    it("url-encodes the form body and sets the correct content type", async () => {
      mockHttpsResponse(200, { access_token: "tok" });

      const result = await postForm("https://example.com/token", { grant_type: "client_credentials" });

      expect(result).toEqual({ access_token: "tok" });
      const [opts] = (https.request as jest.Mock).mock.calls[0];
      expect(opts.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    });
  });

  describe("getJson", () => {
    it("performs a GET request and returns parsed JSON", async () => {
      mockHttpsResponse(200, { items: [1, 2, 3] });

      const result = await getJson("https://example.com/api/list");

      expect(result).toEqual({ items: [1, 2, 3] });
      const [opts] = (https.request as jest.Mock).mock.calls[0];
      expect(opts.method).toBe("GET");
    });
  });
});
