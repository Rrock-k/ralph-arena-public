export type LocalConfigSeverity = "critical" | "warning";

export interface LocalConfigReadinessItem {
  key: string;
  severity: LocalConfigSeverity;
  status: "ok" | "missing";
  effect: string;
  note: string;
  location: string;
  action: string;
}

export interface LocalConfigReadinessSnapshot {
  enabled: boolean;
  items: LocalConfigReadinessItem[];
  criticalMissing: LocalConfigReadinessItem[];
  warningMissing: LocalConfigReadinessItem[];
  splitConfigNote: string;
}

function hasValue(value: string | undefined | null): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function getLocalConfigReadiness(): LocalConfigReadinessSnapshot {
  const items: LocalConfigReadinessItem[] = [
    {
      key: "GITHUB_TOKEN",
      severity: "critical",
      status: hasValue(process.env.GITHUB_TOKEN) ? "ok" : "missing",
      effect: "New project provisioning and auto-create repo",
      note: "Missing this does not kill the whole stack, but +Project and some provisioning flows fail immediately.",
      location: "root .env.local",
      action: "Set it there, then retry provisioning.",
    },
    {
      key: "SECRETS_ENCRYPTION_KEY",
      severity: "critical",
      status: hasValue(process.env.SECRETS_ENCRYPTION_KEY) ? "ok" : "missing",
      effect: "Project secrets storage and readback",
      note: "If this is missing, required secrets can no longer be safely stored or decrypted.",
      location: "root .env.local",
      action: "Set it there and keep it stable; changing it invalidates stored secrets.",
    },
    {
      key: "ARENA_ADMIN_SECRET",
      severity: "critical",
      status: hasValue(process.env.ARENA_ADMIN_SECRET) ? "ok" : "missing",
      effect: "arena-ctl and admin ctl API access",
      note: "The admin UI can still load, but ctl-style operator tools break or show not configured.",
      location: "root .env.local",
      action: "Set it there so docker-local-stack can inject it into governance, then restart the app stack.",
    },
    {
      key: "TELEGRAM_OIDC_CLIENT_ID + TELEGRAM_OIDC_CLIENT_SECRET",
      severity: "warning",
      status:
        hasValue(process.env.TELEGRAM_OIDC_CLIENT_ID) &&
        hasValue(process.env.TELEGRAM_OIDC_CLIENT_SECRET)
          ? "ok"
          : "missing",
      effect: "Telegram sign-in",
      note: "Google sign-in still works, but Telegram OIDC sign-in and account linking are disabled.",
      location: "root .env.local",
      action: "Create Telegram OIDC credentials in BotFather and set both values, then restart governance.",
    },
    {
      key: "TELEGRAM_WEBAPP_BOT_ID",
      severity: "warning",
      status: hasValue(process.env.TELEGRAM_WEBAPP_BOT_ID) ? "ok" : "missing",
      effect: "Telegram WebApp automatic Project Interaction handoff",
      note: "Telegram WebApp can still show the Arena sign-in fallback, but embedded Project API auth will not happen automatically.",
      location: "root .env.local",
      action: "Set the numeric bot id for the tg-spec Telegram bot, then restart governance.",
    },
    {
      key: "RUNNER_WEBHOOK_SECRET / WORKER_SECRET",
      severity: "warning",
      status:
        hasValue(process.env.RUNNER_WEBHOOK_SECRET) || hasValue(process.env.WORKER_SECRET)
          ? "ok"
          : "missing",
      effect: "Internal worker and runner auth",
      note: "Local dev currently tolerates this with permissive fallbacks, so the stack can look healthy while running without proper internal auth.",
      location: "root .env.local or worker env",
      action: "Set one of them before relying on worker/runner auth.",
    },
    {
      key: "PREVIEW_DOMAIN",
      severity: "warning",
      status: hasValue(process.env.PREVIEW_DOMAIN) ? "ok" : "missing",
      effect: "Canonical preview URLs and restore hints",
      note: "Missing this usually degrades into derived or local defaults instead of a hard failure.",
      location: "root .env.local",
      action: "Set it if you want stable preview URLs; otherwise derived defaults apply.",
    },
  ];

  return {
    enabled: process.env.NODE_ENV !== "production",
    items,
    criticalMissing: items.filter((item) => item.severity === "critical" && item.status === "missing"),
    warningMissing: items.filter((item) => item.severity === "warning" && item.status === "missing"),
    splitConfigNote:
      "Local Docker/devprod loads root .env/.env.local first and governance app .env files later without override. Root .env.local is the preferred local source; app env files are for standalone governance or direct Next runs.",
  };
}
