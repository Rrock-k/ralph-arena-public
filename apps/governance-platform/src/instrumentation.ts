import * as Sentry from "@sentry/nextjs";
import {
  resolveGovernanceScheduler,
  type GovernanceSchedulerDecision,
} from "./lib/governance-scheduler-role";

type ScheduledCronRunResult = {
  success: boolean;
  error?: string;
};

type ScheduledRun = {
  key: string;
  label: string;
  intervalMs: number;
  initialDelayMs?: number;
};

type ScheduledRunRecorder = (run: ScheduledRun) => Promise<ScheduledCronRunResult>;

const DEFAULT_DB_BACKUP_INTERVAL_MS = 6 * 60 * 60_000;
const DEFAULT_DB_BACKUP_INITIAL_DELAY_MS = 5 * 60_000;

export const INSTRUMENTED_CRON_SCHEDULES = [
  { key: "cron:seasons", label: "seasons", intervalMs: 60_000 },
  { key: "cron:provisioner", label: "provisioner", intervalMs: 10_000 },
  { key: "cron:reaper", label: "reaper", intervalMs: 60_000 },
  { key: "cron:budget", label: "budget", intervalMs: 30_000 },
  { key: "cron:auto-retry", label: "auto-retry", intervalMs: 30_000 },
  { key: "cron:cleanup", label: "cleanup/ssh-keys", intervalMs: 300_000 },
] as const;

export function buildInstrumentedMaintenanceSchedules(
  env: NodeJS.ProcessEnv = process.env,
): ScheduledRun[] {
  return [
    {
      key: "maintenance:db-backup",
      label: "db-backup",
      intervalMs: readPositiveInt(env.ARENA_DB_BACKUP_INTERVAL_MS, DEFAULT_DB_BACKUP_INTERVAL_MS),
      initialDelayMs: readPositiveInt(env.ARENA_DB_BACKUP_INITIAL_DELAY_MS, DEFAULT_DB_BACKUP_INITIAL_DELAY_MS),
    },
  ];
}

export function resolveCronBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const port = env.PORT || env.APP_PORT || "3000";
  return `http://localhost:${port}`;
}

export function resolveInstrumentedScheduler(
  env: NodeJS.ProcessEnv = process.env,
): GovernanceSchedulerDecision {
  return resolveGovernanceScheduler(env);
}

export async function recordScheduledRunTick(
  run: ScheduledRun,
  recorder: ScheduledRunRecorder = defaultScheduledRunRecorder,
) {
  try {
    const result = await recorder(run);
    if (!result.success) {
      throw new Error(result.error || `scheduled-run recorder returned success=false for ${run.key}`);
    }
  } catch (error) {
    console.warn(
      `[cron] Failed to record scheduled run for ${run.label}:`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function defaultScheduledRunRecorder(run: ScheduledRun) {
  const baseUrl = resolveCronBaseUrl();
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  const cronSecret = process.env.CRON_SECRET || "";
  if (cronSecret) headers["x-cron-secret"] = cronSecret;

  const response = await fetch(`${baseUrl}/api/internal/maintenance-jobs/scheduled-run`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      key: run.key,
      label: run.label,
      minIntervalMs: run.intervalMs,
    }),
  });

  if (!response.ok) {
    throw new Error(`scheduled-run recorder returned HTTP ${response.status}`);
  }

  return response.json() as Promise<ScheduledCronRunResult>;
}

/**
 * Next.js instrumentation hook — runs once when the server starts.
 *
 * - Sentry SDK initialization (server + edge)
 * - In development, sets up periodic crons matching production behavior:
 *   Seasons, Provisioner, Reaper, Budget guard
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }

  // Only run cron in the Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME === "edge") return;

  const scheduler = resolveInstrumentedScheduler(process.env);
  if (!scheduler.enabled) {
    console.log(
      scheduler.role
        ? `[cron] Scheduler disabled for governance role: ${scheduler.role}`
        : `[cron] Scheduler disabled: ${scheduler.blocker}`,
    );
    return;
  }

  // Small delay to let the dev server fully start
  setTimeout(() => {
    console.log("[cron] Scheduling: seasons (60s), provisioner (10s), reaper (60s), budget (30s), auto-retry (30s), cleanup/ssh-keys (5m)");
    for (const cron of INSTRUMENTED_CRON_SCHEDULES) {
      setInterval(
        () => recordScheduledRunTick(cron),
        cron.intervalMs,
      );
    }

  }, 5_000);

  for (const job of buildInstrumentedMaintenanceSchedules()) {
    setTimeout(() => {
      void recordScheduledRunTick(job);
      setInterval(
        () => recordScheduledRunTick(job),
        job.intervalMs,
      );
    }, job.initialDelayMs ?? job.intervalMs);
  }
}

function readPositiveInt(value: string | undefined, fallback: number) {
  const parsed = value ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const onRequestError = Sentry.captureRequestError;
