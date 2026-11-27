import type { OIDCConfig } from "next-auth/providers";

export const TELEGRAM_AUTH_PROVIDER_ID = "telegram";
export const TELEGRAM_OIDC_ISSUER = "https://oauth.telegram.org";
export const TELEGRAM_OIDC_AUTHORIZATION_URL = `${TELEGRAM_OIDC_ISSUER}/auth?scope=openid%20profile`;
export const TELEGRAM_OIDC_TOKEN_URL = `${TELEGRAM_OIDC_ISSUER}/token`;

export type TelegramOidcProfile = {
  sub?: string;
  id?: string | number | null;
  name?: string | null;
  preferred_username?: string | null;
  picture?: string | null;
};

function readOptionalTrimmed(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function readTelegramNumericId(value: unknown): string | null {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    return String(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return /^\d+$/.test(trimmed) ? trimmed : null;
  }
  return null;
}

export function readTelegramOidcSubject(profile: unknown): string | null {
  if (!profile || typeof profile !== "object") return null;
  const subject = (profile as { sub?: unknown }).sub;
  if (typeof subject !== "string" && typeof subject !== "number") return null;
  const value = String(subject).trim();
  return value || null;
}

export function readTelegramOidcRawUserId(profile: unknown): string | null {
  if (!profile || typeof profile !== "object") return null;
  return readTelegramNumericId((profile as { id?: unknown }).id);
}

export function isTelegramOidcConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.TELEGRAM_OIDC_CLIENT_ID?.trim() && env.TELEGRAM_OIDC_CLIENT_SECRET?.trim());
}

export function mapTelegramOidcProfile(profile: TelegramOidcProfile) {
  const subject = readTelegramOidcSubject(profile);
  if (!subject) {
    throw new Error("Telegram OIDC profile is missing sub");
  }
  const rawUserId = readTelegramOidcRawUserId(profile);
  const id = rawUserId ?? subject;

  const name = readOptionalTrimmed(profile.name);
  const username = readOptionalTrimmed(profile.preferred_username);
  const displayName = name ?? (username ? `@${username}` : `Telegram ${id}`);

  return {
    id,
    name: displayName,
    email: null,
    image: readOptionalTrimmed(profile.picture),
  };
}

export function TelegramOidcProvider(): OIDCConfig<TelegramOidcProfile> {
  const clientId = process.env.TELEGRAM_OIDC_CLIENT_ID?.trim();
  const clientSecret = process.env.TELEGRAM_OIDC_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new Error("Telegram OIDC client credentials are not configured");
  }

  return {
    id: TELEGRAM_AUTH_PROVIDER_ID,
    name: "Telegram",
    type: "oidc",
    issuer: TELEGRAM_OIDC_ISSUER,
    authorization: TELEGRAM_OIDC_AUTHORIZATION_URL,
    token: TELEGRAM_OIDC_TOKEN_URL,
    clientId,
    clientSecret,
    // Telegram rejects Auth.js encrypted state JWTs as "state too long".
    // Keep PKCE + OIDC nonce checks and intentionally omit Auth.js state.
    checks: ["pkce", "nonce"],
    idToken: true,
    profile: mapTelegramOidcProfile,
    style: {
      brandColor: "#54a9eb",
    },
  };
}

export function getTelegramOidcProvider(): OIDCConfig<TelegramOidcProfile> | null {
  if (!isTelegramOidcConfigured()) return null;
  return TelegramOidcProvider();
}
