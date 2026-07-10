import Razorpay from "razorpay";
import { config } from "./index";

/**
 * Whether Razorpay is actually configured for this deployment. Callers
 * should check this before hitting any Razorpay endpoint so we can
 * return a clear "not configured" error instead of an opaque SDK
 * exception when RAZORPAY_KEY_ID/SECRET are unset (e.g. local/dev boxes
 * that don't have real Razorpay credentials).
 */
export const isRazorpayConfigured = (): boolean =>
  Boolean(config.razorpay.keyId && config.razorpay.keySecret);

let client: Razorpay | null = null;

export const getRazorpayClient = (): Razorpay => {
  if (!isRazorpayConfigured()) {
    throw new Error("Razorpay is not configured (missing RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET)");
  }
  if (!client) {
    client = new Razorpay({
      key_id: config.razorpay.keyId,
      key_secret: config.razorpay.keySecret,
    });
  }
  return client;
};
