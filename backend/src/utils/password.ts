import crypto from "crypto";

/**
 * Generates a random one-time login password, shared by every
 * "admin resets someone's password" flow (student, staff, ...).
 * Built from an unambiguous character set (no 0/O/1/l/I) since this is
 * meant to be read off a screen and typed/relayed by hand - still
 * satisfies changePasswordSchema's own new-password rule (8+ chars, at
 * least one uppercase letter, at least one digit) so the recipient can
 * keep using it as-is or change it via the normal "Change Password"
 * flow afterwards.
 *
 * Extracted out of student.controller.ts (where this first existed) so
 * staff.controller.ts's resetStaffPassword can reuse the exact same
 * generation logic instead of duplicating it.
 */
export const generateOneTimePassword = (): string => {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(10);
  let password = "";
  for (let i = 0; i < bytes.length; i++) {
    password += chars[bytes[i] % chars.length];
  }
  // Guarantee at least one uppercase + one digit regardless of what
  // the random draw above happened to produce, since the character
  // pool doesn't make that certain on its own.
  return `${password}A9`;
};
