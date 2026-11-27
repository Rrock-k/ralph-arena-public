import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_TTL_SECONDS = 10 * 60;

export type TelegramWebAppLinkTokenPayload = {
  telegramUserId: string;
  iat: number;
  exp: number;
};

export type TelegramWebAppLinkTokenVerificationResult =
  | {
    ok: true;
    payload: TelegramWebAppLinkTokenPayload;
  }
  | {
    ok: false;
    reason: "missing_secret" | "malformed" | "invalid_signature" | "expired" | "invalid_payload";
  };

function readSecret(): string | null {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  return typeof secret === "string" && secret.trim() ? secret.trim() : null;
}

function signPayload(payloadPart: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadPart).digest("base64url");
}

function decodePayload(payloadPart: string): unknown {
  return JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
}

function isValidPayload(payload: unknown): payload is TelegramWebAppLinkTokenPayload {
  if (!payload || typeof payload !== "object") return false;
  const candidate = payload as Partial<TelegramWebAppLinkTokenPayload>;
  const iat = candidate.iat;
  const exp = candidate.exp;
  return (
    typeof candidate.telegramUserId === "string"
    && /^\d+$/.test(candidate.telegramUserId)
    && typeof iat === "number"
    && typeof exp === "number"
    && Number.isSafeInteger(iat)
    && Number.isSafeInteger(exp)
    && exp > iat
  );
}

export function createTelegramWebAppLinkToken(
  telegramUserId: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): string | null {
  const secret = readSecret();
  if (!secret) return null;

  const payload: TelegramWebAppLinkTokenPayload = {
    telegramUserId,
    iat: nowSeconds,
    exp: nowSeconds + TOKEN_TTL_SECONDS,
  };
  const payloadPart = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${payloadPart}.${signPayload(payloadPart, secret)}`;
}

export function verifyTelegramWebAppLinkToken(
  token: string | null | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): TelegramWebAppLinkTokenVerificationResult {
  const secret = readSecret();
  if (!secret) return { ok: false, reason: "missing_secret" };

  const trimmed = typeof token === "string" ? token.trim() : "";
  const [payloadPart, signaturePart, extraPart] = trimmed.split(".");
  if (!payloadPart || !signaturePart || extraPart !== undefined) {
    return { ok: false, reason: "malformed" };
  }

  const expectedSignature = signPayload(payloadPart, secret);
  const provided = Buffer.from(signaturePart, "base64url");
  const expected = Buffer.from(expectedSignature, "base64url");
  if (provided.byteLength !== expected.byteLength || !timingSafeEqual(provided, expected)) {
    return { ok: false, reason: "invalid_signature" };
  }

  let payload: unknown;
  try {
    payload = decodePayload(payloadPart);
  } catch {
    return { ok: false, reason: "invalid_payload" };
  }

  if (!isValidPayload(payload)) {
    return { ok: false, reason: "invalid_payload" };
  }

  if (payload.exp < nowSeconds) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, payload };
}
