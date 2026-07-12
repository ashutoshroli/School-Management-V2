import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import prisma from "../config/database";
import { sendEmail } from "./notification/emailProvider";
import { config } from "../config";
import { logger } from "../config/logger";

const TOKEN_EXPIRY_HOURS = 2;

export const initiatePasswordReset = async (email: string): Promise<boolean> => {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    select: { id: true, name: true, email: true },
  });
  if (!user) return true; // Never reveal existence

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

  // Invalidate old tokens
  await prisma.$executeRawUnsafe(
    `UPDATE "PasswordResetToken" SET "usedAt" = NOW() WHERE "userId" = $1 AND "usedAt" IS NULL`,
    user.id
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO "PasswordResetToken" ("id", "userId", "token", "expiresAt", "createdAt") VALUES (gen_random_uuid(), $1, $2, $3, NOW())`,
    user.id, token, expiresAt
  );

  const resetUrl = `${config.frontendUrl}/auth/reset-password?token=${token}`;

  try {
    await sendEmail({
      to: user.email,
      subject: "Password Reset - School ERP",
      body: `Hi ${user.name},\n\nClick to reset: ${resetUrl}\n\nExpires in ${TOKEN_EXPIRY_HOURS} hours.\n\nSchool ERP`,
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto"><h2 style="color:#1a56db">Password Reset</h2><p>Hi <b>${user.name}</b>,</p><p><a href="${resetUrl}" style="background:#1a56db;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">Reset Password</a></p><p style="color:#6b7280;font-size:14px">Expires in ${TOKEN_EXPIRY_HOURS} hours. Ignore if you didn't request this.</p></div>`,
    });
    return true;
  } catch (error) {
    logger.error("Failed to send password reset email", { userId: user.id, errorMessage: (error as Error).message });
    return false;
  }
};

export const resetPassword = async (token: string, newPassword: string): Promise<{ success: boolean; message: string }> => {
  const records = await prisma.$queryRawUnsafe<Array<{ id: string; userId: string; expiresAt: Date; usedAt: Date | null }>>(
    `SELECT "id", "userId", "expiresAt", "usedAt" FROM "PasswordResetToken" WHERE "token" = $1 LIMIT 1`, token
  );

  if (!records || records.length === 0) return { success: false, message: "Invalid or expired reset link" };
  const record = records[0];
  if (record.usedAt) return { success: false, message: "This reset link has already been used" };
  if (new Date() > new Date(record.expiresAt)) return { success: false, message: "This reset link has expired" };

  const hashedPassword = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: record.userId }, data: { password: hashedPassword } });
  await prisma.$executeRawUnsafe(`UPDATE "PasswordResetToken" SET "usedAt" = NOW() WHERE "id" = $1`, record.id);

  return { success: true, message: "Password reset successfully" };
};
