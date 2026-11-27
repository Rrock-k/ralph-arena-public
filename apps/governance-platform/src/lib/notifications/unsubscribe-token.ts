import { createHmac, timingSafeEqual } from "node:crypto";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
  type NotificationChannel,
  type NotificationEventType,
} from "./types";

const TOKEN_VERSION = "nu1";
const DEFAULT_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 30;

type TransactionalUnsubscribePayload = {
  userId: string;
  eventType: NotificationEventType;
  channel: NotificationChannel;
  exp: number;
};

type CreateTransactionalUnsubscribeTokenInput = {
  userId: string;
  eventType: NotificationEventType;
  channel: NotificationChannel;
  expiresInSeconds?: number;
};

export type VerifiedTransactionalUnsubscribeToken =
  | ({ ok: true } & TransactionalUnsubscribePayload)
  | { ok: false; error: "invalid" | "expired" };

function getSigningSecret() {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret || secret.trim().length < 16) {
    throw new Error("Notification unsubscribe signing secret is not configured");
  }
  return secret;
}

function encodePayload(payload: TransactionalUnsubscribePayload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(encodedPayload: string): unknown {
  return JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
}

function signPayload(encodedPayload: string) {
  return createHmac("sha256", getSigningSecret())
    .update(`${TOKEN_VERSION}.${encodedPayload}`)
    .digest("base64url");
}

function isNotificationEventType(value: unknown): value is NotificationEventType {
  return typeof value === "string" && (NOTIFICATION_EVENTS as readonly string[]).includes(value);
}

function isNotificationChannel(value: unknown): value is NotificationChannel {
  return typeof value === "string" && (NOTIFICATION_CHANNELS as readonly string[]).includes(value);
}

function isPayload(value: unknown): value is TransactionalUnsubscribePayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.userId === "string" &&
    candidate.userId.length > 0 &&
    isNotificationEventType(candidate.eventType) &&
    isNotificationChannel(candidate.channel) &&
    typeof candidate.exp === "number" &&
    Number.isFinite(candidate.exp)
  );
}

export function createTransactionalUnsubscribeToken(
  input: CreateTransactionalUnsubscribeTokenInput,
  now = new Date(),
) {
  const expiresInSeconds =
    typeof input.expiresInSeconds === "number"
      ? Math.max(1, Math.floor(input.expiresInSeconds))
      : DEFAULT_EXPIRES_IN_SECONDS;
  const payload: TransactionalUnsubscribePayload = {
    userId: input.userId,
    eventType: input.eventType,
    channel: input.channel,
    exp: Math.floor(now.getTime() / 1000) + expiresInSeconds,
  };
  const encodedPayload = encodePayload(payload);
  return `${TOKEN_VERSION}.${encodedPayload}.${signPayload(encodedPayload)}`;
}

export function verifyTransactionalUnsubscribeToken(
  token: string | null | undefined,
  now = new Date(),
): VerifiedTransactionalUnsubscribeToken {
  if (!token) {
    return { ok: false, error: "invalid" };
  }

  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION || !parts[1] || !parts[2]) {
    return { ok: false, error: "invalid" };
  }

  const [, encodedPayload, signature] = parts;
  const expectedSignature = signPayload(encodedPayload);
  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { ok: false, error: "invalid" };
  }

  try {
    const payload = decodePayload(encodedPayload);
    if (!isPayload(payload)) {
      return { ok: false, error: "invalid" };
    }

    if (payload.exp < Math.floor(now.getTime() / 1000)) {
      return { ok: false, error: "expired" };
    }

    return { ok: true, ...payload };
  } catch {
    return { ok: false, error: "invalid" };
  }
}
