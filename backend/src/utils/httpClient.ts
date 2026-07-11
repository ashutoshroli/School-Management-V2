import https from "https";
import { URL } from "url";

/**
 * Minimal dependency-free JSON HTTP client built on Node's built-in
 * `https` module.
 *
 * Why not axios/node-fetch? To keep the notification providers
 * (SMS/WhatsApp/Push) genuinely drop-in without growing the dependency
 * tree - Node 18+ (this project's minimum, per README) ships a global
 * `fetch`, but using it here would require adding "DOM"/"undici-types"
 * to tsconfig's `lib` (currently just ES2020) which risks pulling in
 * unrelated global type names. A tiny `https`-based helper avoids that
 * entirely while still giving every provider a single, testable seam
 * (mock `postJson`/`getJson`, not the network).
 */

export class HttpError extends Error {
  statusCode: number;
  body: unknown;

  constructor(message: string, statusCode: number, body: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.body = body;
  }
}

export interface HttpRequestOptions {
  headers?: Record<string, string>;
  /** Request timeout in ms. Defaults to 10s - notification sends must
   *  never hang a request indefinitely. */
  timeoutMs?: number;
}

const request = (
  method: "GET" | "POST" | "DELETE",
  url: string,
  rawPayload: string | undefined,
  contentType: string,
  options: HttpRequestOptions = {}
): Promise<{ statusCode: number; data: any }> => {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);

    const req = https.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers: {
          "Content-Type": contentType,
          Accept: "application/json",
          ...(rawPayload ? { "Content-Length": Buffer.byteLength(rawPayload) } : {}),
          ...options.headers,
        },
        timeout: options.timeoutMs ?? 10000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");
          let data: any = raw;
          try {
            data = raw ? JSON.parse(raw) : undefined;
          } catch {
            // Non-JSON response (e.g. plain text error from a gateway) -
            // keep the raw string, callers can still inspect statusCode.
          }
          resolve({ statusCode: res.statusCode || 0, data });
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error(`Request to ${parsed.hostname} timed out`));
    });
    req.on("error", (err) => reject(err));

    if (rawPayload) req.write(rawPayload);
    req.end();
  });
};

/**
 * POSTs JSON and returns the parsed JSON response. Throws HttpError for
 * any non-2xx response so callers can `catch` a single error type
 * regardless of which gateway/provider they're talking to.
 */
export const postJson = async (
  url: string,
  body: unknown,
  options?: HttpRequestOptions
): Promise<any> => {
  const payload = body !== undefined ? JSON.stringify(body) : undefined;
  const { statusCode, data } = await request("POST", url, payload, "application/json", options);
  if (statusCode < 200 || statusCode >= 300) {
    throw new HttpError(`Request failed with status ${statusCode}`, statusCode, data);
  }
  return data;
};

/**
 * POSTs a `application/x-www-form-urlencoded` body (needed by gateways
 * like Twilio and MSG91's legacy endpoints that don't accept JSON).
 */
export const postForm = async (
  url: string,
  form: Record<string, string>,
  options?: HttpRequestOptions
): Promise<any> => {
  const payload = new URLSearchParams(form).toString();
  const { statusCode, data } = await request(
    "POST",
    url,
    payload,
    "application/x-www-form-urlencoded",
    options
  );
  if (statusCode < 200 || statusCode >= 300) {
    throw new HttpError(`Request failed with status ${statusCode}`, statusCode, data);
  }
  return data;
};

export const getJson = async (url: string, options?: HttpRequestOptions): Promise<any> => {
  const { statusCode, data } = await request("GET", url, undefined, "application/json", options);
  if (statusCode < 200 || statusCode >= 300) {
    throw new HttpError(`Request failed with status ${statusCode}`, statusCode, data);
  }
  return data;
};
