import { toErrorMessage } from "../result.js";
import type { ArenaCtlContext } from "../tool-context.js";

export type AuthdOperatorDigestProvider = "codex" | "claude";

type AuthdHealthSnapshot = {
  configured?: boolean;
  available?: boolean;
  ok?: boolean;
  error?: string | null;
  providers?: Record<string, AuthdProviderHealth | undefined>;
};

type AuthdProviderHealth = {
  provider?: string;
  source?: string | null;
  status?: string;
  version?: string | null;
  checkedAt?: string | null;
  detail?: string | null;
  metadata?: unknown;
};

export type AuthdOperatorDigest = {
  status: "clean" | "needs_attention" | "blocked";
  provider: AuthdOperatorDigestProvider;
  providerHealth: {
    status: string;
    source: string | null;
    version: string | null;
    checkedAt: string | null;
    detail: string | null;
  } | null;
  action: {
    required: boolean;
    command: string | null;
    reason: string;
  };
  operatorDigest: string;
  evidenceNotes: string[];
};

type SanitizedAuthdProviderHealth = NonNullable<AuthdOperatorDigest["providerHealth"]>;

const PROVIDER_RELOGIN_COMMANDS: Record<AuthdOperatorDigestProvider, string> = {
  codex: "docker exec -it agents-arena-authd-1 codex login --device-auth",
  claude: "docker exec -it agents-arena-authd-1 claude auth login",
};

export async function readAuthdOperatorDigest(input: {
  ctx: ArenaCtlContext;
  provider: AuthdOperatorDigestProvider;
}): Promise<AuthdOperatorDigest> {
  try {
    const health = await input.ctx.governance.getAuthdHealth() as AuthdHealthSnapshot;
    return buildAuthdOperatorDigest({ health, provider: input.provider });
  } catch (error) {
    return buildAuthdOperatorDigest({
      provider: input.provider,
      health: {
        configured: false,
        available: false,
        ok: false,
        error: toErrorMessage(error),
        providers: {},
      },
    });
  }
}

export function buildAuthdOperatorDigest(input: {
  health: AuthdHealthSnapshot;
  provider: AuthdOperatorDigestProvider;
}): AuthdOperatorDigest {
  const health = input.health;
  const provider = input.provider;

  if (!health.configured || !health.available) {
    const reason = health.error || "authd health is not available.";
    return {
      status: "blocked",
      provider,
      providerHealth: null,
      action: {
        required: true,
        command: "./scripts/docker-local-stack.sh up -d authd",
        reason,
      },
      operatorDigest: [
        "status: blocked",
        `authd ${provider}: unavailable - ${singleLine(reason)}`,
        "action: ./scripts/docker-local-stack.sh up -d authd, then rerun arena-ctl authd_operator_digest",
        "confidence: sanitized authd health was unavailable; no provider auth values were read",
      ].join("\n"),
      evidenceNotes: [
        "Digest is derived from governance authd health readback only.",
        "It does not refresh providers, mint run auth, write auth files or send Telegram messages.",
      ],
    };
  }

  const providerHealth = sanitizeProviderHealth(provider, health.providers?.[provider]);
  if (providerHealth.status === "ready") {
    return {
      status: "clean",
      provider,
      providerHealth,
      action: {
        required: false,
        command: null,
        reason: "provider_ready",
      },
      operatorDigest: [
        "status: clean",
        `authd ${provider}: ready${providerHealth.checkedAt ? ` at ${providerHealth.checkedAt}` : ""}`,
        "action: none",
        "confidence: sanitized authd health readback; no provider auth values were read",
      ].join("\n"),
      evidenceNotes: [
        "Digest is derived from governance authd health readback only.",
        "It does not refresh providers, mint run auth, write auth files or send Telegram messages.",
      ],
    };
  }

  const reloginCommand = PROVIDER_RELOGIN_COMMANDS[provider];
  const detail = providerHealth.detail || "provider is not ready.";
  return {
    status: "needs_attention",
    provider,
    providerHealth,
    action: {
      required: true,
      command: reloginCommand,
      reason: `${provider}_${providerHealth.status}`,
    },
    operatorDigest: [
      "status: needs attention",
      `authd ${provider}: ${providerHealth.status} - ${singleLine(detail)}`,
      `action: ${reloginCommand}`,
      "confidence: sanitized authd health readback; delivery layer should only deliver this digest",
    ].join("\n"),
    evidenceNotes: [
      "Digest is derived from governance authd health readback only.",
      "It does not refresh providers, mint run auth, write auth files or send Telegram messages.",
    ],
  };
}

function sanitizeProviderHealth(
  provider: AuthdOperatorDigestProvider,
  raw: AuthdProviderHealth | undefined,
): SanitizedAuthdProviderHealth {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      status: "missing",
      source: null,
      version: null,
      checkedAt: null,
      detail: `Provider ${provider} was not returned by authd.`,
    };
  }

  return {
    status: nonEmptyString(raw.status) ?? "unknown",
    source: nonEmptyString(raw.source),
    version: nonEmptyString(raw.version),
    checkedAt: nonEmptyString(raw.checkedAt),
    detail: nonEmptyString(raw.detail),
  };
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
