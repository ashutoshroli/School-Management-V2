import jwt from "jsonwebtoken";
import { config } from "../../config";
import { postForm, postJson } from "../../utils/httpClient";

/**
 * Push notification provider - Firebase Cloud Messaging (FCM HTTP v1
 * API), Phase 1.
 *
 * FCM's v1 API authenticates with a short-lived OAuth2 access token
 * (not a static server key like the legacy API, which Google has
 * deprecated). We mint that token ourselves via a JWT assertion signed
 * with the service account's private key - this is the standard
 * "OAuth 2.0 for Server to Server Applications" flow and avoids adding
 * the full `firebase-admin` / `google-auth-library` SDKs as
 * dependencies for what is otherwise a single REST call.
 *
 * Required config (see config/index.ts): FCM_PROJECT_ID,
 * FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY - all three come directly from the
 * Firebase service-account JSON downloaded from the Firebase console.
 */

export const isPushConfigured = (): boolean =>
  Boolean(config.push.projectId && config.push.clientEmail && config.push.privateKey);

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

/**
 * Mints (and caches) an OAuth2 access token for calling the FCM v1 API.
 * Tokens are valid for 1 hour - we refresh 60s early to avoid edge-case
 * expiry-during-request failures.
 */
const getAccessToken = async (): Promise<string> => {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }

  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    {
      iss: config.push.clientEmail,
      scope: FCM_SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    },
    config.push.privateKey,
    { algorithm: "RS256" }
  );

  const response = await postForm(TOKEN_URL, {
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });

  cachedToken = {
    accessToken: response.access_token,
    expiresAt: Date.now() + response.expires_in * 1000,
  };
  return cachedToken.accessToken;
};

export interface SendPushParams {
  /** FCM device registration token (stored per-device in DeviceToken table). */
  token: string;
  title: string;
  body: string;
  /** Arbitrary key-value payload delivered to the app (e.g. deep-link route). */
  data?: Record<string, string>;
}

/** Sends a single push notification to one device token. */
export const sendPush = async ({ token, title, body, data }: SendPushParams): Promise<void> => {
  if (!isPushConfigured()) {
    throw new Error("Push notifications are not configured (missing FCM_PROJECT_ID/FCM_CLIENT_EMAIL/FCM_PRIVATE_KEY)");
  }

  const accessToken = await getAccessToken();

  await postJson(
    `https://fcm.googleapis.com/v1/projects/${config.push.projectId}/messages:send`,
    {
      message: {
        token,
        notification: { title, body },
        data,
      },
    },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
};

/**
 * Sends the same notification to multiple device tokens, one request
 * per token (FCM v1 doesn't support true multicast in a single call -
 * that's what the legacy API offered). Failures for individual tokens
 * are swallowed and returned in `failedTokens` (e.g. an uninstalled
 * app's token comes back as NOT_FOUND/UNREGISTERED) so the caller can
 * clean those up, rather than one bad token failing the whole batch.
 */
export const sendPushToMany = async (
  tokens: string[],
  payload: { title: string; body: string; data?: Record<string, string> }
): Promise<{ sent: number; failedTokens: string[] }> => {
  const failedTokens: string[] = [];
  let sent = 0;

  await Promise.all(
    tokens.map(async (token) => {
      try {
        await sendPush({ token, ...payload });
        sent++;
      } catch (err) {
        console.error(`Push delivery failed for token ${token.slice(0, 12)}...:`, (err as Error).message);
        failedTokens.push(token);
      }
    })
  );

  return { sent, failedTokens };
};
