import "server-only";

import { createPublicKey, verify as verifySignature } from "node:crypto";
import type { KeyObject } from "node:crypto";
import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { TELEGRAM_AUTH_PROVIDER_ID } from "@/lib/telegram-oidc-provider";

export const TELEGRAM_WEBAPP_INIT_DATA_HEADER = "x-telegram-webapp-init-data";

const TELEGRAM_PRODUCTION_PUBLIC_KEY_HEX = "e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d";
const ED25519_SPKI_DER_PREFIX_HEX = "302a300506032b6570032100";
const DEFAULT_MAX_AGE_SECONDS = 24 * 60 * 60;
const FUTURE_CLOCK_SKEW_SECONDS = 5 * 60;

type TelegramWebAppUser = {
  id: string;
  username?: string;
  firstName?: string;
  lastName?: string;
};

export type TelegramWebAppVerificationResult =
  | {
    ok: true;
    telegramUserId: string;
    authDate: number;
    user: TelegramWebAppUser;
    startParam?: string;
  }
  | {
    ok: false;
    reason:
      | "missing_init_data"
      | "missing_bot_id"
      | "invalid_bot_id"
      | "missing_signature"
      | "invalid_signature"
      | "missing_auth_date"
      | "invalid_auth_date"
      | "expired"
      | "missing_user"
      | "invalid_user";
  };

export type TelegramWebAppSessionResult =
  | {
    status: "ok";
    telegramUserId: string;
    startParam?: string;
    session: Session;
  }
  | {
    status: Exclude<TelegramWebAppVerificationResult, { ok: true }>["reason"] | "unlinked";
    telegramUserId?: string;
  };

type VerifyTelegramWebAppInitDataOptions = {
  botId?: string | null;
  nowSeconds?: number;
  maxAgeSeconds?: number;
  publicKeyHex?: string;
};

function readTrimmed(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function readBotId(input: string | null | undefined): string | null | "invalid" {
  const botId = readTrimmed(input);
  if (!botId) return null;
  return /^\d+$/.test(botId) ? botId : "invalid";
}

function buildEd25519PublicKey(publicKeyHex: string): KeyObject | null {
  if (!/^[0-9a-f]{64}$/i.test(publicKeyHex)) return null;
  const der = Buffer.concat([
    Buffer.from(ED25519_SPKI_DER_PREFIX_HEX, "hex"),
    Buffer.from(publicKeyHex, "hex"),
  ]);
  return createPublicKey({ key: der, format: "der", type: "spki" });
}

function readSingleParam(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key);
  return values.length === 1 ? values[0] : null;
}

export function buildTelegramWebAppSignatureDataCheckString(
  params: URLSearchParams,
  botId: string,
): string {
  const entries = Array.from(params.entries())
    .filter(([key]) => key !== "hash" && key !== "signature")
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => (
      leftKey === rightKey
        ? leftValue.localeCompare(rightValue)
        : leftKey.localeCompare(rightKey)
    ));

  return [
    `${botId}:WebAppData`,
    ...entries.map(([key, value]) => `${key}=${value}`),
  ].join("\n");
}

function readAuthDate(params: URLSearchParams): number | null {
  const raw = readSingleParam(params, "auth_date");
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

function readTelegramUser(params: URLSearchParams): TelegramWebAppUser | null | "invalid" {
  const raw = readSingleParam(params, "user");
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const id = parsed.id;
    if (typeof id !== "string" && typeof id !== "number") return "invalid";
    const telegramUserId = String(id).trim();
    if (!telegramUserId) return "invalid";

    return {
      id: telegramUserId,
      ...(typeof parsed.username === "string" && parsed.username.trim()
        ? { username: parsed.username.trim() }
        : {}),
      ...(typeof parsed.first_name === "string" && parsed.first_name.trim()
        ? { firstName: parsed.first_name.trim() }
        : {}),
      ...(typeof parsed.last_name === "string" && parsed.last_name.trim()
        ? { lastName: parsed.last_name.trim() }
        : {}),
    };
  } catch {
    return "invalid";
  }
}

function readTelegramStartParam(params: URLSearchParams): string | undefined {
  const value = readSingleParam(params, "start_param")?.trim();
  return value || undefined;
}

function decodeSignature(signature: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(signature)) return null;
  const decoded = Buffer.from(signature, "base64url");
  return decoded.byteLength === 64 ? decoded : null;
}

export function verifyTelegramWebAppInitData(
  initData: string | null | undefined,
  options: VerifyTelegramWebAppInitDataOptions = {},
): TelegramWebAppVerificationResult {
  const rawInitData = readTrimmed(initData);
  if (!rawInitData) return { ok: false, reason: "missing_init_data" };

  const botId = readBotId(options.botId ?? process.env.TELEGRAM_WEBAPP_BOT_ID);
  if (!botId) return { ok: false, reason: "missing_bot_id" };
  if (botId === "invalid") return { ok: false, reason: "invalid_bot_id" };

  const params = new URLSearchParams(rawInitData);
  const signatureParam = readSingleParam(params, "signature");
  if (!signatureParam) return { ok: false, reason: "missing_signature" };

  const signature = decodeSignature(signatureParam);
  if (!signature) return { ok: false, reason: "invalid_signature" };

  const authDate = readAuthDate(params);
  if (authDate === null) {
    return readSingleParam(params, "auth_date")
      ? { ok: false, reason: "invalid_auth_date" }
      : { ok: false, reason: "missing_auth_date" };
  }

  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const maxAgeSeconds = options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
  if (
    authDate > nowSeconds + FUTURE_CLOCK_SKEW_SECONDS
    || nowSeconds - authDate > maxAgeSeconds
  ) {
    return { ok: false, reason: "expired" };
  }

  const user = readTelegramUser(params);
  if (!user) return { ok: false, reason: "missing_user" };
  if (user === "invalid") return { ok: false, reason: "invalid_user" };

  const publicKey = buildEd25519PublicKey(
    options.publicKeyHex ?? TELEGRAM_PRODUCTION_PUBLIC_KEY_HEX,
  );
  if (!publicKey) return { ok: false, reason: "invalid_signature" };

  const dataCheckString = buildTelegramWebAppSignatureDataCheckString(params, botId);
  const isValid = verifySignature(
    null,
    Buffer.from(dataCheckString, "utf8"),
    publicKey,
    signature,
  );
  if (!isValid) return { ok: false, reason: "invalid_signature" };

  const startParam = readTelegramStartParam(params);
  return {
    ok: true,
    telegramUserId: user.id,
    authDate,
    user,
    ...(startParam ? { startParam } : {}),
  };
}

export async function resolveTelegramWebAppSessionFromInitData(
  initData: string | null | undefined,
  options: VerifyTelegramWebAppInitDataOptions = {},
): Promise<TelegramWebAppSessionResult> {
  const verification = verifyTelegramWebAppInitData(initData, options);
  if (!verification.ok) {
    return { status: verification.reason };
  }

  const account = await prisma.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider: TELEGRAM_AUTH_PROVIDER_ID,
        providerAccountId: verification.telegramUserId,
      },
    },
    select: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
          role: true,
        },
      },
    },
  });

  if (!account?.user) {
    return {
      status: "unlinked",
      telegramUserId: verification.telegramUserId,
    };
  }

  return {
    status: "ok",
    telegramUserId: verification.telegramUserId,
    ...(verification.startParam ? { startParam: verification.startParam } : {}),
    session: {
      user: {
        id: account.user.id,
        email: account.user.email,
        name: account.user.name,
        image: account.user.image,
        role: account.user.role,
      },
      expires: new Date(Date.now() + DEFAULT_MAX_AGE_SECONDS * 1000).toISOString(),
    },
  };
}
