import { config } from "../../config";

/**
 * SMS provider - STUB IMPLEMENTATION.
 *
 * No real SMS gateway credentials (e.g. MSG91/Twilio) are available in
 * this environment, so this provider logs what *would* be sent instead
 * of actually sending it, and clearly flags itself as such in the
 * response. It is designed as a drop-in seam: to go live, replace the
 * body of `sendSms` with an actual HTTP call to your SMS gateway (most
 * gateways are a single POST request with an API key) - no other file
 * in the codebase needs to change, since notification.service.ts only
 * depends on this function's signature.
 */

export const isSmsConfigured = (): boolean => Boolean(config.sms.apiKey);

export interface SendSmsParams {
  to: string;
  body: string;
}

export const sendSms = async ({ to, body }: SendSmsParams): Promise<void> => {
  if (!isSmsConfigured()) {
    throw new Error("SMS is not configured (missing SMS_API_KEY) - configure a real gateway to enable sending");
  }

  // TODO(production): replace with a real gateway call, e.g.:
  //   await axios.post("https://api.msg91.com/api/v5/flow/", {
  //     sender: config.sms.senderId, mobiles: to, ...
  //   }, { headers: { authkey: config.sms.apiKey } });
  console.log(`[SMS STUB] Would send to ${to} via sender "${config.sms.senderId}": ${body}`);
};
