import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import prisma from "../config/database";
import { sendEmail } from "./notification/emailProvider";
import { config } from "../config";
import { logger } from "../config/logger";

const TOKEN_EXPIRY_HOURS = 2;

/**
 * Generates a password reset token, stores it in DB, and sends
 * the reset link via email.
 *
 * Returns true if the email was successfully dispatched, false
 * otherwise. NEVER reveals whether the email actually exists in the
 * system (to prevent user enumeration) - the caller should always
 * return a generic "if the email exists, we sent a link" message.
 */
export const initiatePasswordReset = async (email: string): Promise<boolean> => {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    select: { id: true, name: true, email: true },
  });

  // Don't reveal whether the user exists - silently succeed
  if (!user) return true;

  // Generate a secure random token
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

  // Invalidate any existing unused tokens for this user
  await prisma.$executeRawUnsafe(
    `UPDATE "PasswordResetToken" SET "usedAt" = NOW() WHERE "userId" = $1 AND "usedAt" IS NULL`,
    user.id
  );

  // Store the new token
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PasswordResetToken" ("id", "userId", "token", "expiresAt", "createdAt") VALUES (gen_random_uuid(), $1, $2, $3, NOW())`,
    user.id,
    token,
    expiresAt
  );

  // Build the reset URL
  const resetUrl = `${config.frontendUrl}/auth/reset-password?token=${token}`;

  try {
    await sendEmail({
      to: user.email,
      subject: "Password Reset - School ERP",
      body: `Hi ${user.name},\n\nYou requested a password reset. Click the link below to set a new password:\n\n${resetUrl}\n\nThis link expires in ${TOKEN_EXPIRY_HOURS} hours.\n\nIf you didn't request this, please ignore this email.\n\nSchool ERP`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1a56db;">Password Reset</h2>
          <p>Hi <strong>${user.name}</strong>,</p>
          <p>You requested a password reset. Click the button below to set a new password:</p>
          <p style="margin: 24px 0;">
            <a href="${resetUrl}" style="background: #1a56db; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">
              Reset Password
            </a>
          </p>
          <p style="color: #6b7280; font-size: 14px;">This link expires in ${TOKEN_EXPIRY_HOURS} hours.</p>
          <p style="color: #6b7280; font-size: 14px;">If you didn't request this, please ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
          <p style="color: #9ca3af; font-size: 12px;">School ERP</p>
        </div>
      `,
    });
    return true;
  } catch (error) {
    logger.error("Failed to send password reset email", {
      userId: user.id,
      errorMessage: (error as Error).message,
    });
    return false;
  }
};

/**
 * Validates a reset token and updates the user's password.
 * Returns { success, message } for the controller to relay.
 */
export const resetPassword = async (
  token: string,
  newPassword: string
): Promise<{ success: boolean; message: string }> => {
  // Find the token
  const resetToken = await prisma.$queryRawUnsafe<
    Array<{ id: string; userId: string; expiresAt: Date; usedAt: Date | null }>
  >(
    `SELECT "id", "userId", "expiresAt", "usedAt" FROM "PasswordResetToken" WHERE "token" = $1 LIMIT 1`,
    token
  );

  if (!resetToken || resetToken.length === 0) {
    return { success: false, message: "Invalid or expired reset link" };
  }

  const record = resetToken[0];

  if (record.usedAt) {
    return { success: false, message: "This reset link has already been used" };
  }

  if (new Date() > new Date(record.expiresAt)) {
    return { success: false, message: "This reset link has expired" };
  }

  // Hash the new password and update
  const hashedPassword = await bcrypt.hash(newPassword, 12);

  await prisma.user.update({
    where: { id: record.userId },
    data: { password: hashedPassword },
  });

  // Mark token as used
  await prisma.$executeRawUnsafe(
    `UPDATE "PasswordResetToken" SET "usedAt" = NOW() WHERE "id" = $1`,
    record.id
  );

  return { success: true, message: "Password reset successfully" };
};
