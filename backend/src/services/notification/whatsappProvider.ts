import { config } from "../../config";

/**
 * WhatsApp provider - STUB IMPLEMENTATION.
 *
 * Same rationale as smsProvider.ts: no real WhatsApp Business API
 * credentials (e.g. Interakt/Wati/Gupshup) are available here, so this
 * logs the message instead of sending it. Swap the body of
 * `sendWhatsapp` for a real HTTP call to config.whatsapp.apiUrl to go
 * live - the rest of the app is unaffected.
 */

export const isWhatsappConfigured = (): boolean =>
  Boolean(config.whatsapp.apiKey && config.whatsapp.apiUrl);

export interface SendWhatsappParams {
  to: string;
  body: string;
}

export const sendWhatsapp = async ({ to, body }: SendWhatsappParams): Promise<void> => {
  if (!isWhatsappConfigured()) {
    throw new Error("WhatsApp is not configured (missing WHATSAPP_API_KEY/WHATSAPP_API_URL)");
  }

  // TODO(production): replace with a real API call, e.g.:
  //   await axios.post(`${config.whatsapp.apiUrl}/messages`, { to, body }, {
  //     headers: { Authorization: `Bearer ${config.whatsapp.apiKey}` },
  //   });
  console.log(`[WHATSAPP STUB] Would send to ${to}: ${body}`);
};
