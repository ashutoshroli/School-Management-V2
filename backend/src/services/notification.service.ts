import { NotificationChannel, NotificationType } from "@prisma/client";
import prisma from "../config/database";
import { sendEmail } from "./notification/emailProvider";
import { sendSms } from "./notification/smsProvider";
import { sendWhatsapp } from "./notification/whatsappProvider";

export interface NotifyParams {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Defaults to ["EMAIL"] - pass additional channels (SMS/WHATSAPP) explicitly. */
  channels?: NotificationChannel[];
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
export const notify = async ({ userId, type, title, body, channels = [NotificationChannel.EMAIL] }: NotifyParams): Promise<void> => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, phone: true } });
  if (!user) return;

  await Promise.all(
    channels.map(async (channel) => {
      const record = await prisma.notification.create({
        data: { userId, title, body, type, channel, status: "PENDING" },
      });

      try {
        switch (channel) {
          case NotificationChannel.EMAIL:
            if (!user.email) throw new Error("User has no email on file");
            await sendEmail({ to: user.email, subject: title, body });
            break;
          case NotificationChannel.SMS:
            if (!user.phone) throw new Error("User has no phone on file");
            await sendSms({ to: user.phone, body: `${title}: ${body}` });
            break;
          case NotificationChannel.WHATSAPP:
            if (!user.phone) throw new Error("User has no phone on file");
            await sendWhatsapp({ to: user.phone, body: `${title}: ${body}` });
            break;
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
