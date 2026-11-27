/**
 * Gets the list of admin emails from the environment variable.
 * @returns Array of admin email addresses
 */
export function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);
}

export function getAdminTelegramUserIds(): string[] {
  return (process.env.ADMIN_TELEGRAM_USER_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

/**
 * Determines if an email should be assigned admin role.
 * @param email - The email address to check
 * @returns true if the email is in the admin list, false otherwise
 */
export function shouldBeAdmin(email: string): boolean {
  const adminEmails = getAdminEmails();
  return adminEmails.includes(email);
}

export function shouldTelegramUserBeAdmin(telegramUserId: string | number): boolean {
  const adminTelegramUserIds = getAdminTelegramUserIds();
  return adminTelegramUserIds.includes(String(telegramUserId).trim());
}
