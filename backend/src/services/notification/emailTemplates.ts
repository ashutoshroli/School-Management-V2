/**
 * Lightweight HTML email templates (Phase 1 - Email Enhancement).
 *
 * Deliberately implemented as plain template-literal functions instead
 * of pulling in a templating engine (Handlebars/EJS/MJML) - the emails
 * sent by this app are a handful of fixed layouts, not user-authored
 * content, so a full templating engine would be dependency weight
 * without real benefit. Every function returns both `html` and `text`
 * (nodemailer sends both - `text` is the fallback for clients that
 * don't render HTML, and improves spam-filter scoring).
 */

export interface EmailTemplateResult {
  subject: string;
  html: string;
  text: string;
}

const SCHOOL_BRAND_COLOR = "#1e3a8a";

const wrapLayout = (title: string, bodyHtml: string): string => `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="background:${SCHOOL_BRAND_COLOR};padding:20px 24px;">
                <span style="color:#ffffff;font-size:18px;font-weight:bold;">School ERP</span>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;color:#0f172a;font-size:14px;line-height:1.6;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px;background:#f8fafc;color:#94a3b8;font-size:11px;">
                This is an automated message from your school's ERP system. Please do not reply directly to this email.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

export const feePaymentReceiptEmail = (params: {
  studentName: string;
  amount: number;
  receiptNo: string;
  paidAt: Date;
  receiptDownloadUrl?: string;
}): EmailTemplateResult => {
  const amountStr = `Rs ${params.amount.toLocaleString("en-IN")}`;
  const dateStr = params.paidAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  const html = wrapLayout(
    "Fee Payment Received",
    `
    <h2 style="margin:0 0 12px;color:${SCHOOL_BRAND_COLOR};">Payment Received</h2>
    <p>We have successfully received a fee payment for <strong>${params.studentName}</strong>.</p>
    <table role="presentation" width="100%" style="margin:16px 0;border-collapse:collapse;">
      <tr><td style="padding:6px 0;color:#64748b;">Amount</td><td style="padding:6px 0;font-weight:bold;">${amountStr}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;">Receipt No.</td><td style="padding:6px 0;">${params.receiptNo}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;">Date</td><td style="padding:6px 0;">${dateStr}</td></tr>
    </table>
    ${
      params.receiptDownloadUrl
        ? `<p><a href="${params.receiptDownloadUrl}" style="display:inline-block;background:${SCHOOL_BRAND_COLOR};color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;">Download Receipt</a></p>`
        : ""
    }
    <p style="color:#64748b;">Thank you for your prompt payment.</p>`
  );

  const text = `Payment Received\n\nWe have successfully received a fee payment of ${amountStr} for ${params.studentName}.\nReceipt No: ${params.receiptNo}\nDate: ${dateStr}\n${
    params.receiptDownloadUrl ? `Download receipt: ${params.receiptDownloadUrl}\n` : ""
  }`;

  return { subject: `Fee Payment Received - Receipt ${params.receiptNo}`, html, text };
};

export const feeReminderEmail = (params: {
  parentName: string;
  studentName: string;
  pendingAmount: number;
  dueDate?: string;
  payNowUrl?: string;
}): EmailTemplateResult => {
  const amountStr = `Rs ${params.pendingAmount.toLocaleString("en-IN")}`;

  const html = wrapLayout(
    "Fee Payment Reminder",
    `
    <h2 style="margin:0 0 12px;color:#b91c1c;">Fee Payment Reminder</h2>
    <p>Dear ${params.parentName},</p>
    <p>This is a reminder that a fee payment of <strong>${amountStr}</strong> for <strong>${params.studentName}</strong> is currently pending${
      params.dueDate ? ` (due on ${params.dueDate})` : ""
    }.</p>
    ${
      params.payNowUrl
        ? `<p><a href="${params.payNowUrl}" style="display:inline-block;background:#b91c1c;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;">Pay Now</a></p>`
        : ""
    }
    <p style="color:#64748b;">Please make the payment at your earliest convenience to avoid late fees. If you have already paid, please disregard this reminder.</p>`
  );

  const text = `Fee Payment Reminder\n\nDear ${params.parentName},\nA fee payment of ${amountStr} for ${params.studentName} is pending${
    params.dueDate ? ` (due on ${params.dueDate})` : ""
  }.\n${params.payNowUrl ? `Pay now: ${params.payNowUrl}\n` : ""}`;

  return { subject: `Fee Payment Reminder for ${params.studentName}`, html, text };
};

export const welcomeEmail = (params: {
  name: string;
  email: string;
  temporaryPassword?: string;
  loginUrl: string;
}): EmailTemplateResult => {
  const html = wrapLayout(
    "Welcome to School ERP",
    `
    <h2 style="margin:0 0 12px;color:${SCHOOL_BRAND_COLOR};">Welcome, ${params.name}!</h2>
    <p>Your account has been created on the School ERP portal.</p>
    <table role="presentation" width="100%" style="margin:16px 0;border-collapse:collapse;">
      <tr><td style="padding:6px 0;color:#64748b;">Login Email</td><td style="padding:6px 0;font-weight:bold;">${params.email}</td></tr>
      ${
        params.temporaryPassword
          ? `<tr><td style="padding:6px 0;color:#64748b;">Temporary Password</td><td style="padding:6px 0;font-weight:bold;">${params.temporaryPassword}</td></tr>`
          : ""
      }
    </table>
    <p><a href="${params.loginUrl}" style="display:inline-block;background:${SCHOOL_BRAND_COLOR};color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;">Login Now</a></p>
    ${params.temporaryPassword ? `<p style="color:#64748b;">For security, please change your password after logging in.</p>` : ""}`
  );

  const text = `Welcome, ${params.name}!\n\nYour account has been created.\nLogin Email: ${params.email}\n${
    params.temporaryPassword ? `Temporary Password: ${params.temporaryPassword}\n` : ""
  }Login: ${params.loginUrl}\n`;

  return { subject: "Welcome to School ERP", html, text };
};

export const genericNotificationEmail = (params: { title: string; body: string }): EmailTemplateResult => {
  const html = wrapLayout(
    params.title,
    `<h2 style="margin:0 0 12px;color:${SCHOOL_BRAND_COLOR};">${params.title}</h2>
     <p>${params.body.replace(/\n/g, "<br/>")}</p>`
  );
  return { subject: params.title, html, text: params.body };
};
