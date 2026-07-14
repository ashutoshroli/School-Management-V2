import nodemailer, { Transporter } from "nodemailer";
import { config } from "../../config";

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
  await getTransporter().sendMail({
    from: `"${config.smtp.fromName}" <${config.smtp.fromEmail}>`,
    to,
    subject,
    text: body,
    html: html || `<p>${body.replace(/\n/g, "<br/>")}</p>`,
    attachments,
  });
};
