export interface RateLimitSignal {
  reasonCode: "rate_limit";
  reasonMessage: string;
  retryAt: Date | null;
  source:
    | "claude_rate_limit_event"
    | "claude_limit_text"
    | "provider_429"
    | "quota_exceeded";
}

type LoopRateLimitTerminal = {
  pauseReason?: string | null;
  retryAt?: string | null;
  reason?: string | null;
};

const CLAUDE_EVENT_RE = /"type"\s*:\s*"rate_limit_event"/i;
const CLAUDE_LIMIT_TEXT_RE = /you(?:'|’)ve hit your (?:(?:usage|session)\s+)?limit/i;
const PROVIDER_429_RE = /\b429\b[\s\S]{0,120}?(too many requests|rate limit)/i;
const TOO_MANY_REQUESTS_RE = /too many requests/i;
const RATE_LIMIT_EXCEEDED_RE = /rate.?limit(?:\s+(?:exceeded|reached|hit))|rate.?limited/i;
const RATE_LIMIT_CODE_RE = /\brate[_-]?limit(?:[_-]?(?:error|exceeded|reached))?\b/i;
const QUOTA_EXCEEDED_RE = /quota exceeded|insufficient_quota/i;
const USAGE_LIMIT_RE = /usage limit(?:\s+(?:reached|exceeded|hit))?/i;
const MESSAGE_LIMIT_RE = /(?:reached|hit|exceeded)\s+your\s+\d+-hour\s+(?:message\s+)?limit/i;
const RESETS_AT_RE = /"resetsAt"\s*:\s*(\d{10,13})/g;
const RESETS_UTC_RE = /resets?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(utc\)/i;
const TIME_ONLY_RESET_GRACE_MS = 5 * 60 * 1000;

function extractUnixResetAt(text: string): Date | null {
  const matches = [...text.matchAll(RESETS_AT_RE)];
  const value = matches.at(-1)?.[1];
  if (!value) return null;

  const raw = Number(value);
  if (!Number.isFinite(raw)) return null;

  const ms = raw >= 1e12 ? raw : raw * 1000;
  const parsed = new Date(ms);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function extractUtcWallClockResetAt(text: string, referenceTime: Date): Date | null {
  const match = text.match(RESETS_UTC_RE);
  if (!match) return null;

  const rawHour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3].toLowerCase();
  if (!Number.isFinite(rawHour) || !Number.isFinite(minute)) return null;

  let hour = rawHour % 12;
  if (meridiem === "pm") hour += 12;

  const retryAt = new Date(Date.UTC(
    referenceTime.getUTCFullYear(),
    referenceTime.getUTCMonth(),
    referenceTime.getUTCDate(),
    hour,
    minute,
    0,
    0,
  ));

  const elapsedMs = referenceTime.getTime() - retryAt.getTime();
  if (elapsedMs > TIME_ONLY_RESET_GRACE_MS) {
    retryAt.setUTCDate(retryAt.getUTCDate() + 1);
  }

  return retryAt;
}

function buildReasonMessage(retryAt: Date | null): string {
  if (retryAt) {
    return `Agent hit provider rate limit. Auto-retry at ${retryAt.toISOString()} (provider reset).`;
  }
  return "Agent hit provider rate limit. Retry scheduled by governance.";
}

export function formatRateLimitReasonMessage(retryAt: Date | null): string {
  return buildReasonMessage(retryAt);
}

export function detectRateLimitSignal(
  text: string,
  options?: { referenceTime?: Date },
): RateLimitSignal | null {
  const referenceTime = options?.referenceTime ?? new Date();
  const retryAt = extractUnixResetAt(text) ?? extractUtcWallClockResetAt(text, referenceTime);

  if (CLAUDE_EVENT_RE.test(text)) {
    return {
      reasonCode: "rate_limit",
      reasonMessage: buildReasonMessage(retryAt),
      retryAt,
      source: "claude_rate_limit_event",
    };
  }

  if (CLAUDE_LIMIT_TEXT_RE.test(text)) {
    return {
      reasonCode: "rate_limit",
      reasonMessage: buildReasonMessage(retryAt),
      retryAt,
      source: "claude_limit_text",
    };
  }

  if (QUOTA_EXCEEDED_RE.test(text)) {
    return {
      reasonCode: "rate_limit",
      reasonMessage: buildReasonMessage(retryAt),
      retryAt,
      source: "quota_exceeded",
    };
  }

  if (USAGE_LIMIT_RE.test(text) || RATE_LIMIT_CODE_RE.test(text) || MESSAGE_LIMIT_RE.test(text)) {
    return {
      reasonCode: "rate_limit",
      reasonMessage: buildReasonMessage(retryAt),
      retryAt,
      source: "provider_429",
    };
  }

  if (PROVIDER_429_RE.test(text) || (TOO_MANY_REQUESTS_RE.test(text) && RATE_LIMIT_EXCEEDED_RE.test(text))) {
    return {
      reasonCode: "rate_limit",
      reasonMessage: buildReasonMessage(retryAt),
      retryAt,
      source: "provider_429",
    };
  }

  if (TOO_MANY_REQUESTS_RE.test(text) && !/pause|retry/i.test(text)) {
    return {
      reasonCode: "rate_limit",
      reasonMessage: buildReasonMessage(retryAt),
      retryAt,
      source: "provider_429",
    };
  }

  if (RATE_LIMIT_EXCEEDED_RE.test(text)) {
    return {
      reasonCode: "rate_limit",
      reasonMessage: buildReasonMessage(retryAt),
      retryAt,
      source: "provider_429",
    };
  }

  return null;
}

export function resolveLoopRateLimitRetryAt(
  result: LoopRateLimitTerminal,
  options?: { referenceTime?: Date },
): string | undefined {
  if (result.pauseReason !== "RATE_LIMIT") return undefined;

  if (typeof result.retryAt === "string" && result.retryAt.trim().length > 0) {
    const parsed = new Date(result.retryAt);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  if (typeof result.reason !== "string" || result.reason.trim().length === 0) {
    return undefined;
  }

  return detectRateLimitSignal(result.reason, options)?.retryAt?.toISOString();
}
