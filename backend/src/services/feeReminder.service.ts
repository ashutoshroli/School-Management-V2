import { NotificationChannel } from "@prisma/client";
import prisma from "../config/database";
import { config } from "../config";
import { notify } from "./notification.service";
import { feeReminderEmail } from "./notification/emailTemplates";

export interface FeeReminderResult {
  totalDefaulters: number;
  notified: number;
  skipped: number;
  errors: Array<{ studentId: string; error: string }>;
}

/**
 * Finds every student in a branch with pending/partial/overdue fee
 * assignments and sends a reminder (Email + SMS) to each linked
 * parent. Designed to be called either:
 *   - on demand, via POST /api/fees/reminders/send (branch admin/
 *     accountant action - see feeCollection.controller.ts), or
 *   - on a schedule, via an external cron trigger (e.g. a daily GitHub
 *     Actions workflow or `node -e "require('./dist/services/feeReminder.service').sendFeeReminders(...)"`
 *     invoked by a system cron job) - this repo intentionally does not
 *     bundle a long-running in-process scheduler (e.g. node-cron) since
 *     that requires the server process to never restart/scale to zero,
 *     which doesn't hold for typical PaaS deployments (Render free tier
 *     sleeps; serverless has no persistent process). An external
 *     trigger calling this same function/endpoint works regardless of
 *     hosting model.
 *
 * One reminder is sent per STUDENT (not per pending fee item) - the
 * email lists the total pending amount across all their pending fee
 * assignments, so a student with 3 overdue fee categories gets a single
 * consolidated reminder rather than 3 separate ones.
 */
export const sendFeeReminders = async (branchId: string): Promise<FeeReminderResult> => {
  const students = await prisma.student.findMany({
    where: {
      branchId,
      isActive: true,
      feeAssignments: { some: { status: { in: ["PENDING", "PARTIAL", "OVERDUE"] } } },
    },
    include: {
      user: { select: { name: true } },
      feeAssignments: {
        where: { status: { in: ["PENDING", "PARTIAL", "OVERDUE"] } },
        include: { feeStructure: { select: { dueDay: true } } },
      },
      parents: { include: { parent: { include: { user: { select: { id: true, name: true, email: true, phone: true } } } } } },
    },
  });

  const result: FeeReminderResult = { totalDefaulters: students.length, notified: 0, skipped: 0, errors: [] };

  for (const student of students) {
    const pendingAmount = student.feeAssignments.reduce((sum, fa) => {
      return sum + (Number(fa.totalAmount) - Number(fa.paidAmount) - Number(fa.discount) + Number(fa.lateFee));
    }, 0);

    if (pendingAmount <= 0) {
      // Fully covered by discounts/waivers despite a non-PAID status row.
      result.skipped++;
      continue;
    }

    if (student.parents.length === 0) {
      result.skipped++;
      continue;
    }

    // Earliest due day among this student's pending fees, for display only.
    const dueDay = student.feeAssignments[0]?.feeStructure?.dueDay;
    const dueDateStr = dueDay ? `the ${dueDay}${ordinalSuffix(dueDay)} of this month` : undefined;
    const payNowUrl = `${config.frontendUrl}/dashboard/fees`;

    for (const sp of student.parents) {
      try {
        const emailTemplate = feeReminderEmail({
          parentName: sp.parent.user.name,
          studentName: student.user.name,
          pendingAmount,
          dueDate: dueDateStr,
          payNowUrl,
        });

        await notify({
          userId: sp.parent.user.id,
          type: "FEE_DUE",
          title: `Fee Payment Reminder for ${student.user.name}`,
          body: `A fee payment of Rs ${pendingAmount.toLocaleString("en-IN")} is pending for ${student.user.name}.`,
          channels: [NotificationChannel.EMAIL, NotificationChannel.SMS],
          emailTemplate,
        });
        result.notified++;
      } catch (error) {
        result.errors.push({ studentId: student.id, error: (error as Error).message });
      }
    }
  }

  return result;
};

const ordinalSuffix = (n: number): string => {
  if (n % 10 === 1 && n !== 11) return "st";
  if (n % 10 === 2 && n !== 12) return "nd";
  if (n % 10 === 3 && n !== 13) return "rd";
  return "th";
};
