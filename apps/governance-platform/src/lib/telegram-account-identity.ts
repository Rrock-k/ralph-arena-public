const RAW_TELEGRAM_USER_ID_PATTERN = /^\d{2,32}$/;

export type TelegramAccountIdentityRow = {
  providerAccountId: string;
  scope?: string | null;
  access_token?: string | null;
  id_token?: string | null;
};

function readTrimmed(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function isRawTelegramUserId(value: string): boolean {
  return RAW_TELEGRAM_USER_ID_PATTERN.test(value.trim());
}

export function isTelegramWebAppRawAccount(account: TelegramAccountIdentityRow): boolean {
  const scope = readTrimmed(account.scope);
  return (
    isRawTelegramUserId(account.providerAccountId)
    && !readTrimmed(account.access_token)
    && !readTrimmed(account.id_token)
    && (!scope || !scope.split(/\s+/).includes("openid"))
  );
}
