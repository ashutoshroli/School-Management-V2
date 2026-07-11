import { NotificationChannel, NotificationType } from "@prisma/client";
import prisma from "../config/database";
import { sendEmail } from "./notification/emailProvider";
import { sendSms } from "./notification/smsProvider";
import { sendWhatsapp } from "./notification/whatsappProvider";
import { sendPushToMany } from "./notification/pushProvider";
import { genericNotificationEmail, EmailTemplateResult } from "./notification/emailTemplates";

export interface NotifyParams {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Defaults to ["EMAIL"] - pass additional channels (SMS/WHATSAPP/PUSH) explicitly. */
  channels?: NotificationChannel[];
  /** Optional pre-rendered HTML email (see notification/emailTemplates.ts).
   *  If omitted, a generic templated email using `title`/`body` is used. */
  emailTemplate?: EmailTemplateResult;
}

/**
 * Central notification dispatcher.
 *
 * For each requested channel, this:
 *   1. Creates a `Notification` row (status PENDING) so there's an
 *      audit trail regardless of whether the send succeeds.
 *   2. Attempts to actually deliver it via the channel's provider.
 *   3. Updates the row to SENT (with sentAt) or FAILED.
 *
 * Failures are swallowed (logged, not thrown) - notifications are a
 * side effect of some other action (a payment, a published notice,
 * etc), and a failed SMS/email must never roll back or fail the
 * primary action that triggered it.
 */
export const notify = async ({
  userId,
  type,
  title,
  body,
  channels = [NotificationChannel.EMAIL],
  emailTemplate,
}: NotifyParams): Promise<void> => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, phone: true } });
  if (!user) return;

  await Promise.all(
    channels.map(async (channel) => {
      const record = await prisma.notification.create({
        data: { userId, title, body, type, channel, status: "PENDING" },
      });

      try {
        switch (channel) {
          case NotificationChannel.EMAIL: {
            if (!user.email) throw new Error("User has no email on file");
            const tmpl = emailTemplate || genericNotificationEmail({ title, body });
            await sendEmail({ to: user.email, subject: tmpl.subject, body: tmpl.text, html: tmpl.html });
            break;
          }
          case NotificationChannel.SMS:
            if (!user.phone) throw new Error("User has no phone on file");
            await sendSms({ to: user.phone, body: `${title}: ${body}` });
            break;
          case NotificationChannel.WHATSAPP:
            if (!user.phone) throw new Error("User has no phone on file");
            await sendWhatsapp({ to: user.phone, body: `${title}: ${body}` });
            break;
          case NotificationChannel.PUSH: {
            const tokens = await prisma.deviceToken.findMany({ where: { userId }, select: { token: true } });
            if (tokens.length === 0) throw new Error("User has no registered device tokens");
            const { sent, failedTokens } = await sendPushToMany(
              tokens.map((t) => t.token),
              { title, body }
            );
            if (failedTokens.length > 0) {
              // Stale/uninstalled tokens - remove them so future sends
              // don't keep retrying a dead token.
              await prisma.deviceToken.deleteMany({ where: { token: { in: failedTokens } } });
            }
            if (sent === 0) throw new Error("Push delivery failed for all registered devices");
            break;
          }
          case NotificationChannel.IN_APP:
            // IN_APP notifications ARE the Notification row itself -
            // nothing further to dispatch, just mark as sent.
            break;
        }

        await prisma.notification.update({
          where: { id: record.id },
          data: { status: "SENT", sentAt: new Date() },
        });
      } catch (error) {
        console.error(`Notification delivery failed (channel=${channel}, userId=${userId}):`, (error as Error).message);
        await prisma.notification.update({
          where: { id: record.id },
          data: { status: "FAILED" },
        });
      }
    })
  );
};

/**
 * Convenience wrapper: notify every parent linked to a student (used
 * for fee-payment confirmations, attendance alerts, etc where the
 * relevant "audience" is the parents, not the student directly).
 */
export const notifyParentsOfStudent = async (
  studentId: string,
  params: Omit<NotifyParams, "userId">
): Promise<void> => {
  const links = await prisma.studentParent.findMany({
    where: { studentId },
    include: { parent: { select: { userId: true } } },
  });

  await Promise.all(links.map((link) => notify({ ...params, userId: link.parent.userId })));
};
