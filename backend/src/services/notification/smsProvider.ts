import { config } from "../../config";
import { postJson } from "../../utils/httpClient";

/**
 * SMS provider - real MSG91 integration (Phase 1).
 *
 * MSG91 is used by default because it's the most common transactional
 * SMS gateway for Indian schools (DLT-compliant, cheap per-SMS cost).
 * Two send modes are supported:
 *
 *  1. Template/Flow mode (recommended, DLT-compliant): set
 *     SMS_TEMPLATE_ID to a pre-approved MSG91 Flow template ID. The
 *     `body` string is sent as a single "VAR1" placeholder - for
 *     anything beyond simple single-variable templates, prefer calling
 *     `sendSmsWithTemplate` directly with named variables.
 *  2. Plain-text mode (fallback, works without DLT template
 *     registration on MSG91 trial/international accounts): uses
 *     MSG91's simple `/api/v5/flow/` with a generic "default" flow, or
 *     the older `/api/sendhttp.php` route if no template is set.
 *
 * Any other SMS gateway (Twilio, Gupshup, etc.) can be swapped in by
 * replacing the body of `sendSms` - this file is the only place that
 * talks to the network for SMS.
 */

export const isSmsConfigured = (): boolean => Boolean(config.sms.apiKey);

export interface SendSmsParams {
  to: string;
  body: string;
}

/** Normalizes a phone number to MSG91's expected format: 91XXXXXXXXXX (no +, no leading 0/spaces). */
const normalizeIndianMobile = (phone: string): string => {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length === 13 && digits.startsWith("091")) return `91${digits.slice(3)}`;
  return digits; // already looks international, or malformed - let the gateway reject it
};

/**
 * Sends a message via MSG91's DLT-approved Flow API using a template ID.
 * `variables` maps MSG91 template placeholder names (e.g. "VAR1") to
 * their values - the template itself is configured in the MSG91
 * dashboard and must match the placeholder names used here.
 */
export const sendSmsWithTemplate = async (
  to: string,
  variables: Record<string, string>
): Promise<void> => {
  if (!isSmsConfigured()) {
    throw new Error("SMS is not configured (missing SMS_API_KEY) - configure a real gateway to enable sending");
  }
  if (!config.sms.templateId) {
    throw new Error("SMS_TEMPLATE_ID is not configured - required for MSG91 Flow API sends");
  }

  await postJson(
    "https://control.msg91.com/api/v5/flow/",
    {
      template_id: config.sms.templateId,
      short_url: "0",
      recipients: [
        {
          mobiles: normalizeIndianMobile(to),
          ...variables,
        },
      ],
    },
    { headers: { authkey: config.sms.apiKey } }
  );
};

/**
 * Sends a plain-text transactional SMS. Used for ad-hoc messages that
 * don't have (or don't need) a pre-registered DLT template - e.g. when
 * SMS_TEMPLATE_ID isn't configured. Note: MSG91 (and Indian TRAI
 * regulations) generally require DLT-registered templates for
 * production sends to Indian numbers - this path exists mainly for
 * international numbers or MSG91 trial accounts.
 */
export const sendSms = async ({ to, body }: SendSmsParams): Promise<void> => {
  if (!isSmsConfigured()) {
    throw new Error("SMS is not configured (missing SMS_API_KEY) - configure a real gateway to enable sending");
  }

  if (config.sms.templateId) {
    // Prefer the DLT-compliant template path when a template is configured.
    await sendSmsWithTemplate(to, { VAR1: body });
    return;
  }

  await postJson(
    "https://control.msg91.com/api/v5/flow/",
    {
      sender: config.sms.senderId,
      route: config.sms.route,
      country: "91",
      sms: [{ message: body, to: [normalizeIndianMobile(to)] }],
    },
    { headers: { authkey: config.sms.apiKey } }
  );
};
