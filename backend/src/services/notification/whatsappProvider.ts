import { config } from "../../config";
import { postJson } from "../../utils/httpClient";

/**
 * WhatsApp provider - real Interakt integration (Phase 1).
 *
 * Interakt (https://www.interakt.shop/) is used by default since it's
 * a common WhatsApp Business Solution Provider (BSP) for Indian
 * businesses/schools with a simple REST API and no per-message
 * infrastructure to run yourself. Swapping to WATI/Gupshup/direct Meta
 * Cloud API only requires changing the request shape in this file -
 * notification.service.ts only depends on `sendWhatsapp`'s signature.
 *
 * IMPORTANT (WhatsApp Business API constraint): outside a 24-hour
 * customer-initiated conversation window, WhatsApp only allows sending
 * pre-approved "template" messages, not arbitrary free text. That's why
 * this file exposes `sendWhatsappTemplate` as the primary function -
 * `sendWhatsapp` (plain text) is kept for the free-text/session-window
 * case (e.g. a teacher replying to a parent who messaged first) but
 * will be rejected by WhatsApp for a cold outbound like a fee reminder.
 */

export const isWhatsappConfigured = (): boolean =>
  Boolean(config.whatsapp.apiKey && config.whatsapp.apiUrl);

export interface SendWhatsappParams {
  to: string;
  body: string;
}

const normalizeIndianMobile = (phone: string): string => {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return digits;
};

/**
 * Sends a pre-approved WhatsApp template message via Interakt.
 * `templateName` must exactly match a template already approved in the
 * Interakt/WhatsApp Business dashboard; `bodyValues` are positional
 * {{1}}, {{2}}... substitutions in the order the template defines them.
 */
export const sendWhatsappTemplate = async (
  to: string,
  templateName: string,
  bodyValues: string[]
): Promise<void> => {
  if (!isWhatsappConfigured()) {
    throw new Error("WhatsApp is not configured (missing WHATSAPP_API_KEY/WHATSAPP_API_URL)");
  }

  await postJson(
    `${config.whatsapp.apiUrl}/message/`,
    {
      countryCode: "+91",
      phoneNumber: normalizeIndianMobile(to).replace(/^91/, ""),
      type: "Template",
      template: {
        name: templateName,
        languageCode: "en",
        bodyValues,
      },
    },
    { headers: { Authorization: `Basic ${config.whatsapp.apiKey}` } }
  );
};

/**
 * Sends free-text WhatsApp (only valid within an active 24h session
 * window - see file header). Prefer `sendWhatsappTemplate` for any
 * business-initiated message like fee reminders/attendance alerts.
 */
export const sendWhatsapp = async ({ to, body }: SendWhatsappParams): Promise<void> => {
  if (!isWhatsappConfigured()) {
    throw new Error("WhatsApp is not configured (missing WHATSAPP_API_KEY/WHATSAPP_API_URL)");
  }

  await postJson(
    `${config.whatsapp.apiUrl}/message/`,
    {
      countryCode: "+91",
      phoneNumber: normalizeIndianMobile(to).replace(/^91/, ""),
      type: "Text",
      message: body,
    },
    { headers: { Authorization: `Basic ${config.whatsapp.apiKey}` } }
  );
};
