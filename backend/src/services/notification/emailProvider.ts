import nodemailer, { Transporter } from "nodemailer";
import { config } from "../../config";
import { logError } from "../../config/logger";

/**
 * Whether SMTP is actually configured. Callers should check this before
 * attempting to send so we can mark the Notification as FAILED with a
 * clear reason instead of nodemailer throwing an opaque connection
 * error when SMTP_HOST/USER/PASS are unset (e.g. local/dev without real
 * email credentials).
 */
export const isEmailConfigured = (): boolean =>
  Boolean(config.smtp.host && config.smtp.user && config.smtp.pass);

let transporter: Transporter | null = null;

const getTransporter = (): Transporter => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    });
  }
  return transporter;
};

export interface SendEmailParams {
  to: string;
  subject: string;
  body: string;
  /** Optional pre-rendered HTML - if omitted, falls back to escaping
   *  `body` with <br/> line breaks (previous behavior). */
  html?: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>;
}

/**
 * Sends a real email via SMTP (nodemailer). Throws if SMTP isn't
 * configured or the send fails - callers (notification.service.ts)
 * catch this and record it as a FAILED Notification rather than
 * crashing the request that triggered it (e.g. a fee payment should
 * still succeed even if the confirmation email fails to send).
 */
export const sendEmail = async ({ to, subject, body, html, attachments }: SendEmailParams): Promise<void> => {
  if (!isEmailConfigured()) {
    throw new Error("Email is not configured (missing SMTP_HOST/SMTP_USER/SMTP_PASS)");
  }

  // SMTP_FROM_EMAIL lets the "From" display address differ from the
  // SMTP auth user (e.g. a shared relay account authenticating as one
  // address but sending "from" a different one) - config.smtp.fromEmail
  // already falls back to config.smtp.user when SMTP_FROM_EMAIL is
  // unset (see config/index.ts), so this is backward compatible with
  // every deployment that only ever set SMTP_USER.
  try {
    await getTransporter().sendMail({
      from: `"${config.smtp.fromName}" <${config.smtp.fromEmail}>`,
      to,
      subject,
      text: body,
      html: html || `<p>${body.replace(/\n/g, "<br/>")}</p>`,
      attachments,
    });
  } catch (error) {
    // ROOT CAUSE VISIBILITY: previously this error was only re-thrown -
    // never logged anywhere - so a real SMTP failure (wrong
    // credentials, auth rejected, connection refused, etc) was
    // completely invisible in Render's logs/Sentry. nodemailer's
    // SMTPTransport errors carry extra fields (responseCode, command,
    // e.g. "535 5.7.8 Authentication failed" for a bad password) that
    // a plain `error.message` alone can lose - logging the full error
    // object (via logError's `stack`) preserves those. This log call
    // is always safe/production-appropriate - it never reaches the
    // HTTP response, only server-side logs/Sentry.
    logError("sendEmail: SMTP send failed", error, {
      to,
      host: config.smtp.host,
      port: config.smtp.port,
      // Deliberately logging only WHICH user was used to authenticate,
      // never the password - see the equivalent care taken with the
      // razorpay/R2 config elsewhere in this codebase.
      smtpUser: config.smtp.user,
    });
    throw error;
  }
};
